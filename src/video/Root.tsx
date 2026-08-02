import React from 'react';
import {Composition} from 'remotion';
import './fonts';
import {Reel, reelDuration} from './insta/Reel';
import type {ReelData} from './insta/schema';
import sample from '../../data/sample.json';

export const VideoRoot: React.FC = () => {
  return (
    <Composition
      id="Reel"
      component={Reel}
      durationInFrames={reelDuration((sample as ReelData).slides.length)}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={sample as ReelData}
      calculateMetadata={({props}) => ({
        durationInFrames: reelDuration(props.slides.length),
        props,
      })}
    />
  );
};
