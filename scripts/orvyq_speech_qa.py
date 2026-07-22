#!/usr/bin/env python3
# Deliberate change vs golden (docs/source-audit.md section 3, threshold-drift
# finding): --min-similarity used to default to a bare 0.55 literal here,
# while orvyq_edit_plan_tests.mjs and orvyq_media_qa.mjs independently
# re-checked the same script_similarity field against a hardcoded 0.85 --
# three copies of the same policy value that could drift. The default here
# now reads direction/editorial_blueprint.json's
# global_rules.minimum_script_similarity (0.85), the same field the two
# Node scripts read. An explicit --min-similarity still overrides it.
import argparse
import json
import re
import subprocess
import tempfile
from difflib import SequenceMatcher
from pathlib import Path

from faster_whisper import WhisperModel

DEFAULT_MIN_SIMILARITY = 0.85


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9']+", " ", text.lower()).strip()


def media_duration(media: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", str(media)],
        check=True,
        capture_output=True,
        text=True,
    )
    duration = float(result.stdout.strip())
    if duration <= 0:
        raise RuntimeError(f"Invalid media duration: {duration}")
    return duration


def clip_media(source: Path, seconds: float) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    if not seconds:
        return source, None
    temp_dir = tempfile.TemporaryDirectory(prefix="orvyq-speech-")
    output = Path(temp_dir.name) / "speech_sample.wav"
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-t", str(seconds), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(output),
        ],
        check=True,
    )
    return output, temp_dir


def canonical_min_similarity(project: Path) -> float:
    blueprint_path = project / "direction" / "editorial_blueprint.json"
    if not blueprint_path.exists():
        return DEFAULT_MIN_SIMILARITY
    blueprint = json.loads(blueprint_path.read_text(encoding="utf-8"))
    value = blueprint.get("global_rules", {}).get("minimum_script_similarity")
    return float(value) if value is not None else DEFAULT_MIN_SIMILARITY


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--media")
    parser.add_argument("--max-seconds", type=float, default=0)
    parser.add_argument("--output-name", default="speech_transcript.json")
    parser.add_argument("--model", default="tiny.en")
    parser.add_argument("--min-similarity", type=float, default=None)
    args = parser.parse_args()

    project = Path("projects") / args.project_id
    media = Path(args.media) if args.media else project / "assets" / "audio" / "final_mix.mp3"
    script_path = project / "voice" / "voice_script.txt"
    output = project / "qa" / args.output_name
    output.parent.mkdir(parents=True, exist_ok=True)
    min_similarity = args.min_similarity if args.min_similarity is not None else canonical_min_similarity(project)

    if not media.exists():
        raise SystemExit(f"Missing media for speech QA: {media}")
    if not script_path.exists():
        raise SystemExit(f"Missing reference voice script: {script_path}")

    source_duration = media_duration(media)
    analyzed_duration = min(source_duration, args.max_seconds) if args.max_seconds else source_duration
    analysis_media, temp_dir = clip_media(media, analyzed_duration if args.max_seconds else 0)

    try:
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
        segments, info = model.transcribe(
            str(analysis_media),
            language="en",
            beam_size=3,
            vad_filter=True,
            word_timestamps=True,
            condition_on_previous_text=True,
        )

        transcript_parts: list[str] = []
        words: list[dict] = []
        speech_seconds = 0.0
        for segment in segments:
            transcript_parts.append(segment.text.strip())
            speech_seconds += max(0.0, float(segment.end) - float(segment.start))
            for word in segment.words or []:
                token = word.word.strip()
                if token:
                    words.append({
                        "text": token,
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "probability": round(float(word.probability), 4),
                    })

        transcript = " ".join(part for part in transcript_parts if part).strip()
        reference = script_path.read_text(encoding="utf-8")
        reference_words = normalize(reference).split()
        transcript_words = normalize(transcript).split()

        # Compare the recognized preview against the same-length script prefix.
        reference_prefix_words = reference_words[:len(transcript_words)]
        similarity = SequenceMatcher(None, transcript_words, reference_prefix_words).ratio()
        speech_coverage = speech_seconds / analyzed_duration if analyzed_duration else 0.0
        average_probability = sum(w["probability"] for w in words) / len(words) if words else 0.0

        failures: list[str] = []
        minimum_words = 30 if analyzed_duration <= 150 else 100
        if len(transcript_words) < minimum_words:
            failures.append(f"too_few_spoken_words:{len(transcript_words)}<{minimum_words}")
        if similarity < min_similarity:
            failures.append(f"script_similarity:{similarity:.3f}<{min_similarity:.3f}")
        if speech_coverage < 0.22:
            failures.append(f"speech_coverage:{speech_coverage:.3f}<0.220")
        if average_probability < 0.45:
            failures.append(f"word_probability:{average_probability:.3f}<0.450")

        payload = {
            "schema_version": "1.0-canonical",
            "project_id": args.project_id,
            "media": str(media),
            "model": args.model,
            "language": info.language,
            "min_similarity": min_similarity,
            "source_duration_seconds": round(source_duration, 3),
            "analyzed_duration_seconds": round(analyzed_duration, 3),
            "transcript": transcript,
            "word_count": len(transcript_words),
            "reference_word_count": len(reference_prefix_words),
            "speech_coverage": round(speech_coverage, 4),
            "average_word_probability": round(average_probability, 4),
            "script_similarity": round(similarity, 4),
            "words": words,
            "passed": not failures,
            "failures": failures,
        }
        output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"ok": not failures, "output": str(output), **{k: payload[k] for k in ["word_count", "speech_coverage", "script_similarity", "average_word_probability"]}}))
        if failures:
            raise SystemExit("Speech QA failed: " + ", ".join(failures))
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()


if __name__ == "__main__":
    main()
