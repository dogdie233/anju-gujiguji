import './style.css';
import { WebGPURenderer } from './renderer';

// Setup button events with hold-to-spawn functionality
function setupButtonEvents(button: HTMLButtonElement, renderer: WebGPURenderer) {
  let holdTimer: number | null = null;
  let isHolding = false;
  let spawnInterval: number | null = null;
  const HOLD_THRESHOLD = 300; // ms to distinguish hold from click
  const SPAWN_INTERVAL = 77; // ms between spawns when holding

  const startHold = () => {
    // Start timer to detect if this is a hold (not just a click)
    holdTimer = window.setTimeout(() => {
      isHolding = true;
      // Immediately spawn first batch when hold is detected
      renderer.addParticle();
      // Then spawn continuously
      spawnInterval = window.setInterval(() => {
        renderer.addParticle();
      }, SPAWN_INTERVAL);
    }, HOLD_THRESHOLD);
  };

  const endHold = () => {
    // Clear timers
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (spawnInterval !== null) {
      clearInterval(spawnInterval);
      spawnInterval = null;
    }
    isHolding = false;
  };

  const handleClick = () => {
    // Only trigger click if not holding (click event fires after mouseup)
    if (!isHolding) {
      renderer.addParticle();
    }
  };

  button.addEventListener('mousedown', startHold);
  button.addEventListener('mouseup', endHold);
  button.addEventListener('mouseleave', endHold);
  button.addEventListener('click', handleClick);

  // Touch events
  button.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startHold();
  });
  button.addEventListener('touchend', (e) => {
    e.preventDefault();
    endHold();
    // Manually trigger spawn for touch if not holding
    if (!isHolding) {
      renderer.addParticle();
    }
  });
  button.addEventListener('touchcancel', endHold);
}

async function bootstrap() {
  const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
  const button = document.getElementById('add-button') as HTMLButtonElement;
  const fallbackDiv = document.getElementById('fallback') as HTMLDivElement;

  const renderer = new WebGPURenderer(canvas, button);
  const supported = await renderer.init();

  if (supported) {
    renderer.start();

    // Setup button events
    setupButtonEvents(button, renderer);

    // Expose FPS toggle to console
    (window as any).toggleFPS = (show?: boolean) => renderer.toggleFPS(show);
    console.log('💡 Tip: Use toggleFPS() in console to show/hide FPS overlay');
  } else {
    button.style.display = 'none';
    fallbackDiv.style.display = 'block';
    fallbackDiv.innerHTML = `
            <h1>WebGPU Not Supported</h1>
            <p>Your browser does not support WebGPU. Please use a recent version of Chrome, Edge, or Firefox Nightly.</p>`;
  }
}

bootstrap().catch((err) => {
  console.error(err);
  const fallbackDiv = document.getElementById('fallback') as HTMLDivElement;
  const button = document.getElementById('add-button') as HTMLButtonElement;
  button.style.display = 'none';
  fallbackDiv.style.display = 'block';
  fallbackDiv.innerHTML = `<h1>An Error Occurred</h1><p>${err.message}</p><p>Please check the console for more details.</p>`;
});
