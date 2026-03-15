// DOM ELEMENTS
const video = document.getElementById("video");

const optionMenuElement = document.getElementById("options-menu");
const colorMenuElement = document.getElementById("color-menu");

const optionMenuButtons = optionMenuElement.querySelectorAll("button");
const colorMenuButtons = colorMenuElement.querySelectorAll("button");

const clearButton = document.getElementById("clear-button");
const exportButton = document.getElementById("export-button");

const brushSizeElement = document.getElementById("brush-size");

const fpsCountElement = document.getElementById("fps-counter");

// Main overly canvas
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Persistent drawing canvas
const drawingCanvas = document.getElementById("drawing-canvas");
const drawingCtx = drawingCanvas.getContext("2d");

const brush = {
  color: "#fff",
  size: 15,
  tool: "pencil",
};

// Cache UI positions to check for "air-click" collisions efficiently
let buttonRects = [];

const cacheButtonCoordinates = () => {
  const allButtons = [...optionMenuButtons, ...colorMenuButtons];

  buttonRects = allButtons.map((btn) => ({
    element: btn,
    rect: btn.getBoundingClientRect(),
    type: btn.closest("#options-menu") ? "tool" : "color",
    value: btn.title || btn.value,
  }));
};

window.addEventListener("load", cacheButtonCoordinates);
window.addEventListener("resize", cacheButtonCoordinates);

// UI event listeners
clearButton.addEventListener("click", () => {
  drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
});

exportButton.addEventListener("click", () => {
  drawingCanvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "air-brush.png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
});

// Update UI active states for Tool Selection
optionMenuButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    brush.tool = btn.title;

    optionMenuButtons.forEach((btn) => {
      btn.classList.remove("active-option");
    });

    btn.classList.add("active-option");
  });
});

// Update UI active states for Color Selection
colorMenuButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    brush.color = btn.value;

    colorMenuButtons.forEach((btn) => {
      btn.classList.remove("active-option");
    });

    btn.classList.add("active-option");
  });
});

brushSizeElement.addEventListener("input", () => {
  brush.size = Number(brushSizeElement.value);
});

// MediaPipe Landmark pairs for drawing the skeletal hand
const HAND_CONNECTIONS = [
  [10, 11],
  [11, 12],
  [13, 14],
  [13, 17],
  [14, 15],
  [15, 16],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [5, 9],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 5],
  [9, 10],
  [9, 13],
  [0, 17],
];

let lastFrameTime = performance.now();
let frameCount = 0;
let fps = 0;

function updateFPS() {
  const now = performance.now();
  const delta = now - lastFrameTime;
  frameCount++;
  if (delta >= 500) {
    fps = Math.round((frameCount * 1000) / delta);
    if (fpsCountElement) fpsCountElement.innerText = `${fps} FPS`;
    lastFrameTime = now;
    frameCount = 0;
  }
}

// Maps 0-1 MediaPipe landmarks to screen coordinates with letterboxing adjustment
function drawHand(ctx, landmarks) {
  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const displayWidth = video.clientWidth;
  const displayHeight = video.clientHeight;

  const videoRatio = videoWidth / videoHeight;
  const displayRatio = displayWidth / displayHeight;

  let scale,
    xOffset = 0,
    yOffset = 0;

  // Calculate scaling to ensure hand lines up with the "object-cover" video CSS
  if (displayRatio > videoRatio) {
    scale = displayWidth / videoWidth;
    yOffset = (displayHeight - videoHeight * scale) / 2;
  } else {
    scale = displayHeight / videoHeight;
    xOffset = (displayWidth - videoWidth * scale) / 2;
  }

  ctx.strokeStyle = "#03d14f";
  ctx.fillStyle = "#FF0000";
  ctx.lineWidth = 4;

  HAND_CONNECTIONS.forEach(([start, end]) => {
    const p1 = landmarks[start];
    const p2 = landmarks[end];

    // (1 - x) mirrors the coordinates since the video is scale-x-[-1]
    ctx.beginPath();
    ctx.moveTo(
      (1 - p1.x) * videoWidth * scale + xOffset,
      p1.y * videoHeight * scale + yOffset,
    );
    ctx.lineTo(
      (1 - p2.x) * videoWidth * scale + xOffset,
      p2.y * videoHeight * scale + yOffset,
    );
    ctx.stroke();
  });

  landmarks.forEach((p) => {
    ctx.beginPath();
    ctx.arc(
      (1 - p.x) * video.videoWidth * scale + xOffset,
      p.y * video.videoHeight * scale + yOffset,
      7,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  });

  // Return the calculated [X, Y] of the index finger tip (landmark 8)
  return [
    (1 - landmarks[8].x) * videoWidth * scale + xOffset,
    landmarks[8].y * videoHeight * scale + yOffset,
  ];
}

// Math helpers for gesture recognition
const toVector = (p1, p2) => ({
  x: p2.x - p1.x,
  y: p2.y - p1.y,
  z: p2.z - p1.z,
});
const dotProduct = (v1, v2) => v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
const magnitude = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

// Detects if a finger is straight by comparing joint angles
function isFingerExtended(
  mcpIdx,
  pipIdx,
  dipIdx,
  tipIdx,
  handLandmarks,
  threshold = 0.8,
) {
  const mcp = handLandmarks[mcpIdx];
  const pip = handLandmarks[pipIdx];
  const dip = handLandmarks[dipIdx];
  const tip = handLandmarks[tipIdx];

  const MCP2PIP = toVector(mcp, pip);
  const PIP2DIP = toVector(pip, dip);
  const DIP2TIP = toVector(dip, tip);

  const cosAngleOne =
    magnitude(MCP2PIP) * magnitude(PIP2DIP) !== 0
      ? dotProduct(MCP2PIP, PIP2DIP) / (magnitude(MCP2PIP) * magnitude(PIP2DIP))
      : 0;
  const cosAngleTwo =
    magnitude(PIP2DIP) * magnitude(DIP2TIP) !== 0
      ? dotProduct(PIP2DIP, DIP2TIP) / (magnitude(PIP2DIP) * magnitude(DIP2TIP))
      : 0;

  return cosAngleOne > threshold && cosAngleTwo > threshold;
}

function drawPencil(x, y, ctx) {
  ctx.beginPath();
  ctx.fillStyle = brush.color;
  ctx.arc(x, y, brush.size, 0, Math.PI * 2);
  ctx.fill();
}

function erase(x, y) {
  drawingCtx.beginPath();
  drawingCtx.globalCompositeOperation = "destination-out"; // Acts as a transparent eraser
  drawingCtx.arc(x, y, brush.size, 0, Math.PI * 2);
  drawingCtx.fill();
  drawingCtx.globalCompositeOperation = "source-over";
}

const dist = (p1, p2) =>
  Math.sqrt(
    Math.pow(p1.x - p2.x, 2) +
      Math.pow(p1.y - p2.y, 2) +
      Math.pow(p1.z - p2.z, 2),
  );

const renderTool = (tool, p1, p2, ctx) => {
  switch (tool) {
    case "square":
      {
        ctx.strokeStyle = brush.color;
        ctx.lineWidth = brush.size;
        ctx.beginPath();
        ctx.roundRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, 3);
        ctx.stroke();
      }
      break;

    case "circle":
      {
        let center = {
          x: (p1.x + p2.x) / 2,
          y: (p1.y + p2.y) / 2,
        };

        // Calculate radius using the distance formula
        const radius = Math.sqrt(
          Math.pow(center.x - p1.x, 2) + Math.pow(center.y - p1.y, 2),
        );

        ctx.strokeStyle = brush.color;
        ctx.lineWidth = brush.size;
        ctx.beginPath();
        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;

    case "line":
      {
        ctx.strokeStyle = brush.color;
        ctx.lineWidth = brush.size;
        ctx.lineCap = "round";

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      break;

    default:
      break;
  }
};

// Main loop triggered every time MediaPipe processes a frame
let lastPoint = null;

function handleOnResult(results) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    lastPoint = null;
    return;
  }

  results.multiHandLandmarks.forEach((landmark) => {
    let [x, y] = drawHand(ctx, landmark);

    // Collision Detection: Trigger UI buttons if index tip "touches" them
    buttonRects.forEach(({ element, rect, type, value }) => {
      const isOverlapping =
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

      if (isOverlapping) {
        if (type === "tool" && brush.tool !== value) {
          brush.tool = value;
          element.click();
        } else if (type === "color" && brush.color !== value) {
          brush.color = value;
          element.click();
        }
      }
    });

    // Gesture State Detection
    const fingerUp = isFingerExtended(9, 10, 11, 12, landmark); // Middle finger up (used for drawing trigger)
    const pinkyFingerUp = isFingerExtended(17, 18, 19, 20, landmark); // Pinky up (used for brush sizing)

    if (brush.tool == "eraser") {
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(x, y, Math.max(brush.size - 12, 0), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(x, y, brush.size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawPencil(x, y, ctx);
    }

    // Dynamic Brush Sizing: Distance between Thumb and Index
    if (pinkyFingerUp) {
      const currentDist = dist(landmark[4], landmark[8]);
      const refDist = dist(landmark[0], landmark[17]);

      let normalized = currentDist / refDist;

      const minSize = 10;
      const maxSize = 80;

      // Simple linear interpolation
      let newSize = minSize + normalized * (maxSize - minSize);

      // Clamp values
      brush.size = Math.max(minSize, Math.min(maxSize, newSize));

      if (brushSizeElement) brushSizeElement.value = brush.size;
    }

    // Render brush/eraser visual feedback on the preview layer
    else if (fingerUp) {
      if (brush.tool == "pencil") {
        drawPencil(x, y, drawingCtx);
      } else if (brush.tool === "eraser") {
        erase(x, y);
      } else {
        // Handle Previews for Square, Circle, Line
        if (lastPoint == null) {
          lastPoint = { x, y };
        }

        // Use a helper function to draw the specific tool on the PREVIEW canvas (ctx)
        renderTool(brush.tool, lastPoint, { x, y }, ctx);
      }
    } else {
      // Commit the shape when the finger is lowered
      if (lastPoint) {
        renderTool(brush.tool, lastPoint, { x, y }, drawingCtx);
        lastPoint = null;
      }
    }
  });
}

const hands = new Hands({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.8,
  minTrackingConfidence: 0.8,
});

hands.onResults(handleOnResult);

const camera = new Camera(video, {
  onFrame: async () => {
    updateFPS();
    // Handle dynamic canvas resizing to match responsive video window
    if (
      drawingCanvas.width !== video.clientWidth ||
      drawingCanvas.height !== video.clientHeight
    ) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      drawingCanvas.width = video.clientWidth;
      drawingCanvas.height = video.clientHeight;
    }
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720,
});

camera.start();
