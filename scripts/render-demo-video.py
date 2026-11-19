import glob
import os
import sys

import cv2


def load_frames(frame_directory: str) -> list:
    paths = sorted(glob.glob(os.path.join(frame_directory, "frame-*.png")))
    if not paths:
        raise RuntimeError(f"No frames found in {frame_directory}")
    frames = []
    for path in paths:
        frame = cv2.imread(path)
        if frame is None:
            raise RuntimeError(f"Could not read {path}")
        frames.append(frame)
    return frames


def crossfade(first, second, progress: float):
    return cv2.addWeighted(first, 1 - progress, second, progress, 0)


def render(frame_directory: str, output_path: str) -> None:
    frames = load_frames(frame_directory)
    height, width = frames[0].shape[:2]
    fps = 24
    hold_frames = fps * 2
    transition_frames = 12
    writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer for {output_path}")
    try:
        for index, frame in enumerate(frames):
            for _ in range(hold_frames):
                writer.write(frame)
            if index + 1 < len(frames):
                next_frame = frames[index + 1]
                for transition in range(1, transition_frames + 1):
                    writer.write(crossfade(frame, next_frame, transition / transition_frames))
    finally:
        writer.release()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-demo-video.py <frame-directory> <output.mp4>")
    render(sys.argv[1], sys.argv[2])
