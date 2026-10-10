import { useState } from "react";
import {
  ReactCompareSlider,
  ReactCompareSliderHandle,
  ReactCompareSliderImage,
} from "react-compare-slider";

export function Comparison({
  beforeUrl,
  afterUrl,
  beforeLabel,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel: string;
}) {
  const [position, setPosition] = useState(50);
  return (
    <>
      <ReactCompareSlider
        className="comparison"
        data-testid="comparison-frame"
        defaultPosition={50}
        onlyHandleDraggable={false}
        keyboardIncrement="5%"
        onPositionChange={setPosition}
        itemOne={
          <div className="comparison-photo">
            <ReactCompareSliderImage
              src={beforeUrl}
              alt={beforeLabel}
              style={{ objectFit: "contain" }}
            />
            <span className="comparison-tag left">
              {beforeLabel.toUpperCase()}
            </span>
          </div>
        }
        itemTwo={
          <div className="comparison-photo">
            <ReactCompareSliderImage
              src={afterUrl}
              alt="Current look"
              style={{ objectFit: "contain" }}
            />
            <span className="comparison-tag right">CURRENT</span>
          </div>
        }
        handle={
          <ReactCompareSliderHandle
            buttonStyle={{
              width: 44,
              height: 44,
              background: "#f7f7f2",
              color: "#22271f",
              border: "2px solid #f7f7f2",
            }}
            linesStyle={{ background: "#f7f7f2" }}
          />
        }
      />
      <div className="compare-help">
        <span>Drag the divider, or focus it and use arrow keys.</span>
        <output aria-live="off">{Math.round(position)}%</output>
      </div>
    </>
  );
}
