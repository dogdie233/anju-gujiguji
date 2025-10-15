import { WebGPURenderer } from './renderer';

async function bootstrap() {
    const canvas = document.getElementById('gpu-canvas') as HTMLCanvasElement;
    const button = document.getElementById('add-button') as HTMLButtonElement;
    const fallbackDiv = document.getElementById('fallback') as HTMLDivElement;

    const renderer = new WebGPURenderer(canvas, button);
    const supported = await renderer.init();

    if (supported) {
        renderer.start();
    } else {
        button.style.display = 'none';
        fallbackDiv.style.display = 'block';
        fallbackDiv.innerHTML = `
            <h1>WebGPU Not Supported</h1>
            <p>Your browser does not support WebGPU. Please use a recent version of Chrome, Edge, or Firefox Nightly.</p>`;
    }
}

bootstrap().catch(err => {
    console.error(err);
    const fallbackDiv = document.getElementById('fallback') as HTMLDivElement;
    const button = document.getElementById('add-button') as HTMLButtonElement;
    button.style.display = 'none';
    fallbackDiv.style.display = 'block';
    fallbackDiv.innerHTML = `<h1>An Error Occurred</h1><p>${err.message}</p><p>Please check the console for more details.</p>`;
});