self.importScripts('https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js');
const { createFFmpeg, fetchFile } = FFmpeg;
let ffmpeg = null;

self.onmessage = async (ev) => {
  const { type, payload } = ev.data || {};
  try {
    if (type === 'load') {
      ffmpeg = createFFmpeg({ log: true });
      await ffmpeg.load();
      self.postMessage({ type: 'loaded' });
    } else if (type === 'convert-mp4') {
      const { webmArrayBuffer } = payload;
      await ffmpeg.FS('writeFile', 'input.webm', new Uint8Array(webmArrayBuffer));
      await ffmpeg.run('-i', 'input.webm', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', 'out.mp4');
      const out = ffmpeg.FS('readFile', 'out.mp4');
      self.postMessage({ type: 'done-mp4', payload: out.buffer }, [out.buffer]);
      ffmpeg.FS('unlink', 'input.webm'); ffmpeg.FS('unlink', 'out.mp4');
    } else if (type === 'convert-gif') {
      const { webmArrayBuffer } = payload;
      await ffmpeg.FS('writeFile', 'input.webm', new Uint8Array(webmArrayBuffer));
      await ffmpeg.run('-i', 'input.webm', '-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0', 'out.gif');
      const gif = ffmpeg.FS('readFile', 'out.gif');
      self.postMessage({ type: 'done-gif', payload: gif.buffer }, [gif.buffer]);
      ffmpeg.FS('unlink', 'input.webm'); ffmpeg.FS('unlink', 'out.gif');
    }
  } catch (e) {
    self.postMessage({ type: 'error', payload: String(e) });
  }
};
