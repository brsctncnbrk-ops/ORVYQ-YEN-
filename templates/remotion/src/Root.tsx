import React from "react";
import { Composition } from "remotion";
import { FactForgeVideo } from "./Video";
import sceneConfig from "./data/scene_config.json";

/**
 * A single composition driven entirely by the per-project scene_config.json
 * that scripts/remotion_build.mjs copies into src/data/. This file never
 * needs per-project edits - all the numbers come from the JSON.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="FactForgeVideo"
      component={FactForgeVideo}
      durationInFrames={sceneConfig.duration_frames}
      fps={sceneConfig.fps}
      width={sceneConfig.width}
      height={sceneConfig.height}
    />
  );
};
