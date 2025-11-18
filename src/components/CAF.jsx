import React, { useEffect, useRef, useState } from 'react';
import { grayscale, invert, cartoonRealism, comicBook, artisticSketch } from '../lib/filters';

export default function CAF(){
  const videoRef = useRef(null);
  const inputCanvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const outputCanvasRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const workerRef = useRef(null);

  const [mode, setMode] = useState('camera'); // 'camera' | 'upload'
  const [filter, setFilter] = useState('none');
  const [streaming, setStreaming] = useState(false);
  const [fps, setFps] = useState(0);
  const [status, setStatus] = useState('Ready');
  const [exportBusy, setExportBusy] = useState(false);
  const [gifBusy, setGifBusy] = useState(false);

  // Setup ffmpeg worker
  useEffect(() => {
    const w = new Worker('/ffmpeg-worker.js');
    workerRef.current = w;
    w.onmessage = (ev) => {
      const { type, payload } = ev.data || {};
      if (type === 'loaded') setStatus('FFmpeg ready');
      if (type === 'done-mp4') {
        setExportBusy(false);
        const blob = new Blob([payload], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'caf_output.mp4'; a.click();
      }
      if (type === 'done-gif') {
        setGifBusy(false);
        const blob = new Blob([payload], { type: 'image/gif' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'caf_output.gif'; a.click();
      }
      if (type === 'error') {
        setExportBusy(false); setGifBusy(false);
        setStatus('FFmpeg error: '+payload);
      }
    };
    w.postMessage({ type: 'load' });
    return () => w.terminate();
  }, []);

  // Setup camera
  useEffect(() => {
    if (mode !== 'camera') return;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        videoRef.current.srcObject = s;
        await videoRef.current.play();
        const w = videoRef.current.videoWidth || 640;
        const h = videoRef.current.videoHeight || 480;
        [inputCanvasRef, previewCanvasRef, outputCanvasRef].forEach(ref => { if (ref.current) { ref.current.width = w; ref.current.height = h; }});
      } catch (e) { setStatus('Camera error: ' + e.message); }
    })();
    return () => {
      const s = videoRef.current?.srcObject;
      if (s) s.getTracks().forEach(t => t.stop());
    };
  }, [mode]);

  // Main render loop
  useEffect(() => {
    let raf = null;
    let lastTime = performance.now();
    let frames = 0;

    const loop = async () => {
      const inC = inputCanvasRef.current;
      const prevC = previewCanvasRef.current;
      const outC = outputCanvasRef.current;
      const v = videoRef.current;

      if (!inC || !prevC || !outC) { raf = requestAnimationFrame(loop); return; }

      const inCtx = inC.getContext('2d');
      const prevCtx = prevC.getContext('2d');
      const outCtx = outC.getContext('2d');

      // draw source
      if (mode === 'camera') {
        if (v && v.readyState >= 2) inCtx.drawImage(v, 0, 0, inC.width, inC.height);
      }

      // copy to preview first
      prevCtx.drawImage(inC, 0, 0, prevC.width, prevC.height);

      // apply selected filter onto preview
try {
  if(filter === 'grayscale') {
    grayscale(prevC);
  }
  else if(filter === 'invert') {
    invert(prevC);
  }
  else if (filter === 'cartoon') {
    await cartoonRealism(inC, prevC);
  }
  else if (filter === 'comic') {
    await comicBook(inC, prevC);
  }
  else if (filter === 'sketch') {
    await artisticSketch(inC, prevC);
  }
} catch (err) {
  console.warn("Filter failed:", filter, err);
}


      // none -> leave as is

      // draw preview to output (this is what we record)
      outCtx.clearRect(0,0,outC.width,outC.height);
      outCtx.drawImage(prevC,0,0,outC.width,outC.height);

      // FPS meter
      frames += 1;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frames);
        frames = 0;
        lastTime = now;
      }

      raf = requestAnimationFrame(loop);
    };

    if (streaming) raf = requestAnimationFrame(loop);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [streaming, filter, mode]);

  // Upload video
  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setMode('upload');
    const v = videoRef.current;
    v.srcObject = null;
    v.src = url;
    v.loop = true;
    v.muted = true;
    v.play();
    const setSizes = () => {
      const w = v.videoWidth || 640, h = v.videoHeight || 480;
      [inputCanvasRef, previewCanvasRef, outputCanvasRef].forEach(ref => { if (ref.current){ ref.current.width = w; ref.current.height = h; } });
    };
    v.onloadedmetadata = setSizes;
  };

  // Recording (MediaRecorder → WebM)
  const startRecording = () => {
    const stream = outputCanvasRef.current.captureStream(30);
    chunksRef.current = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.start();
    recorderRef.current = rec;
  };
  const stopRecording = () => { recorderRef.current?.stop(); };

  // Export buttons
  const downloadWebM = () => {
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'caf_output.webm'; a.click();
  };
  const convertMP4 = async () => {
    setExportBusy(true);
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const buf = await blob.arrayBuffer();
    workerRef.current.postMessage({ type: 'convert-mp4', payload: { webmArrayBuffer: buf } }, [buf]);
  };
  const convertGIF = async () => {
    setGifBusy(True);
    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    const buf = await blob.arrayBuffer();
    workerRef.current.postMessage({ type: 'convert-gif', payload: { webmArrayBuffer: buf } }, [buf]);
  };

  return (
    <div className="min-h-screen text-white bg-gray-900 p-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-2">CAF — Camera Animation Filter</h1>
      <p className="text-sm text-gray-400 mb-6">Real-time filters (TensorFlow.js + Canvas). FPS: {fps} | {status}</p>

      <div className="w-full max-w-5xl grid md:grid-cols-3 gap-4 mb-4">
        <div className="md:col-span-2 bg-gray-800 rounded-2xl p-3 shadow">
          <canvas ref={outputCanvasRef} className="w-full rounded-xl" />
          <div className="flex gap-2 mt-3">
            <button onClick={()=>setStreaming(s=>!s)} className="px-4 py-2 rounded bg-indigo-600">
              {streaming ? 'Stop Preview' : 'Start Preview'}
            </button>
            <button onClick={startRecording} className="px-4 py-2 rounded bg-green-600">Start Recording</button>
            <button onClick={stopRecording} className="px-4 py-2 rounded bg-red-600">Stop Recording</button>
            <button onClick={downloadWebM} className="px-4 py-2 rounded bg-gray-700">Save WebM</button>
            <button onClick={convertMP4} disabled={exportBusy} className="px-4 py-2 rounded bg-gray-700 disabled:opacity-50">{exportBusy?'Converting…':'Export MP4'}</button>
            <button onClick={convertGIF} disabled={gifBusy} className="px-4 py-2 rounded bg-gray-700 disabled:opacity-50">{gifBusy?'Converting…':'Export GIF'}</button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-2xl p-3 shadow">
          <div className="space-y-2">
            <label className="block text-sm text-gray-300">Input Source</label>
            <div className="flex gap-2">
              <button onClick={()=>setMode('camera')} className={`px-3 py-2 rounded ${mode==='camera'?'bg-blue-600':'bg-gray-700'}`}>Camera</button>
              <label className="px-3 py-2 rounded bg-gray-700 cursor-pointer">
                Upload Video
                <input type="file" accept="video/*" onChange={onUpload} className="hidden" />
              </label>
            </div>

            <label className="block text-sm text-gray-300 mt-4">Filter</label>
            <select value={filter} onChange={e=>setFilter(e.target.value)} className="w-full p-2 rounded bg-gray-900 border border-gray-700">
              <option value="none">None</option>
              <option value="grayscale">Grayscale</option>
              <option value="invert">Invert</option>
              <option value="cartoon">Cartoon Realism</option>
              <option value="comic">Comic-Book Style</option>
              <option value="sketch">Artistic Sketch</option>
            </select>

            <div className="text-xs text-gray-400 mt-4">
              <p>Tip: Start Preview, then Record, then Stop and Export.</p>
              <p>Performance target: 30 FPS, &lt;50ms per frame. Use 480p for low-end devices.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden working surfaces */}
      <video ref={videoRef} className="hidden" playsInline muted></video>
      <canvas ref={inputCanvasRef} className="hidden"></canvas>
      <canvas ref={previewCanvasRef} className="hidden"></canvas>
    </div>
  );
}
