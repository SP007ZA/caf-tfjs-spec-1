import * as tf from '@tensorflow/tfjs';

/* ----------------------------------------------------
   1. ENSURE TF IS READY + BACKEND INITIALIZED
---------------------------------------------------- */
let tfReady = false;
async function ensureTFReady(){ if(tfReady) return; try{ await tf.setBackend('webgl'); }catch{ await tf.setBackend('cpu'); } await tf.ready(); console.log('TFJS backend', tf.getBackend()); tfReady=true; }

/* ----------------------------------------------------
   2. Utility: Write Tensor to Canvas
---------------------------------------------------- */
export async function tensorToCanvas(t, canvas){ await ensureTFReady(); const tmp=document.createElement('canvas'); tmp.width=canvas.width; tmp.height=canvas.height; await tf.browser.toPixels(t,tmp); const ctx=canvas.getContext('2d'); ctx.drawImage(tmp,0,0,canvas.width,canvas.height); }
/* ----------------------------------------------------
   3. FAST CANVAS FILTERS (SAFE)
---------------------------------------------------- */
export function grayscale(ctxOrCanvas,w,h){ let ctx=ctxOrCanvas; if(ctx?.getContext) ctx=ctx.getContext('2d'); if(!ctx) return; if(!w||!h){ const c=ctx.canvas; if(!c) return; w=c.width; h=c.height; } try{ const img=ctx.getImageData(0,0,w,h); const d=img.data; for(let i=0;i<d.length;i+=4){ const v=((d[i]+d[i+1]+d[i+2])/3)|0; d[i]=d[i+1]=d[i+2]=v;} ctx.putImageData(img,0,0);}catch(e){console.warn('grayscale failed',e);} }
export function invert(ctxOrCanvas,w,h){ let ctx=ctxOrCanvas; if(ctx?.getContext) ctx=ctx.getContext('2d'); if(!ctx) return; if(!w||!h){ const c=ctx.canvas; if(!c) return; w=c.width; h=c.height; } try{ const img=ctx.getImageData(0,0,w,h); const d=img.data; for(let i=0;i<d.length;i+=4){ d[i]=255-d[i]; d[i+1]=255-d[i+1]; d[i+2]=255-d[i+2]; } ctx.putImageData(img,0,0);}catch(e){console.warn('invert failed',e);} }

/* ----------------------------------------------------
   4. SOBEL EDGE (SAFE)
---------------------------------------------------- */
export async function sobelEdgesTensor(sourceCanvas) {
  await ensureTFReady();
  return tf.tidy(() => {
    const x = tf.browser.fromPixels(sourceCanvas)
      .mean(2)
      .expandDims(-1)
      .expandDims(0)
      .toFloat()
      .div(255);

    const kx = tf.tensor4d(
      [[-1,0,1],[-2,0,2],[-1,0,1]],
      [3,3,1,1]
    );
    const ky = tf.tensor4d(
      [[-1,-2,-1],[0,0,0],[1,2,1]],
      [3,3,1,1]
    );

    const gx = tf.conv2d(x, kx, 1, 'same');
    const gy = tf.conv2d(x, ky, 1, 'same');
    const g = tf.sqrt(gx.square().add(gy.square())).squeeze();

    return g.div(g.max().add(1e-5)).expandDims(-1).tile([1,1,3]);
  });
}

/* ----------------------------------------------------
   5. Gaussian Blur (SAFE)
---------------------------------------------------- */
export async function gaussianBlurTensor(sourceCanvas) {
  await ensureTFReady();
  return tf.tidy(() => {
    const x = tf.browser.fromPixels(sourceCanvas)
      .toFloat()
      .div(255)
      .expandDims(0);

    const kernel = tf.tensor1d([1,4,6,4,1]).div(16);

    const kx = kernel.reshape([5,1,1,1]);
    const ky = kernel.reshape([1,5,1,1]);

    const kxRGB = tf.concat([kx,kx,kx], 3);
    const kyRGB = tf.concat([ky,ky,ky], 3);

    const blurred = tf.depthwiseConv2d(x, kxRGB, 1, 'same');
    const blurred2 = tf.depthwiseConv2d(blurred, kyRGB, 1, 'same');

    return blurred2.squeeze().clipByValue(0, 1);
  });
}

/* ----------------------------------------------------
   6. CARTOON REALISM
---------------------------------------------------- */
//----------------------------------------------------
// CARTOON REALISM — Fixed version for your pipeline
//----------------------------------------------------
export async function cartoonRealism(inCanvas, prevCanvas) {
  await ensureTFReady();
  const ctx = prevCanvas.getContext("2d");
  const w = prevCanvas.width;
  const h = prevCanvas.height;

  // 1. Blur input → preview
  const blur = await gaussianBlurTensor(inCanvas);
  await tensorToCanvas(blur, prevCanvas);
  blur.dispose();

  // 2. Posterize preview canvas
  let img = ctx.getImageData(0, 0, w, h);
  let d = img.data;
  const levels = 6;

  for (let i = 0; i < d.length; i += 4) {
    d[i]   = Math.round((d[i]  / 255) * (levels - 1)) * (255 / (levels - 1));
    d[i+1] = Math.round((d[i+1] / 255) * (levels - 1)) * (255 / (levels - 1));
    d[i+2] = Math.round((d[i+2] / 255) * (levels - 1)) * (255 / (levels - 1));
  }
  ctx.putImageData(img, 0, 0);

  // 3. Edge detection ON THE POSTERIZED IMAGE, not on the raw input
  const edges = await sobelEdgesTensor(prevCanvas);

  const eTmp = document.createElement("canvas");
  eTmp.width = w;
  eTmp.height = h;

  await tf.browser.toPixels(edges, eTmp);
  edges.dispose();

  // 4. Multiply edges onto preview to get toon lines
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(eTmp, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}



/* ----------------------------------------------------
   7. COMIC BOOK
---------------------------------------------------- */
//----------------------------------------------------
// COMIC BOOK (Improved)
//----------------------------------------------------
export async function comicBook(inCanvas, prevCanvas) {
  await ensureTFReady();
  const ctx = prevCanvas.getContext("2d");
  const w = prevCanvas.width, h = prevCanvas.height;

  //----------------------------------------------------
  // 1. Copy input → preview
  //----------------------------------------------------
  ctx.drawImage(inCanvas, 0, 0, w, h);

  //----------------------------------------------------
  // 2. Increase contrast + saturation
  //----------------------------------------------------
  let img = ctx.getImageData(0, 0, w, h);
  let d = img.data;

  const contrast = 1.4;
  const saturation = 1.8;

  for (let i = 0; i < d.length; i += 4) {
    // Convert to relative luminance
    const r = d[i], g = d[i+1], b = d[i+2];
    const lum = 0.2126*r + 0.7152*g + 0.0722*b;

    // Increase contrast around middle grey
    const cr = (r - 128) * contrast + 128;
    const cg = (g - 128) * contrast + 128;
    const cb = (b - 128) * contrast + 128;

    // Saturation boost
    d[i]   = lum + (cr - lum) * saturation;
    d[i+1] = lum + (cg - lum) * saturation;
    d[i+2] = lum + (cb - lum) * saturation;
  }
  ctx.putImageData(img, 0, 0);

  //----------------------------------------------------
  // 3. HALFTONE DOTS (smaller + more realistic)
  //----------------------------------------------------
  const cell = 8;  // dot grid size
  ctx.save();
  ctx.globalAlpha = 0.35; // subtle effect
  ctx.fillStyle = "#000";

  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      const lum = (0.2126*p[0] + 0.7152*p[1] + 0.0722*p[2]) / 255;

      const radius = (1 - lum) * (cell * 0.45); // softer aesthetic
      ctx.beginPath();
      ctx.arc(x + cell/2, y + cell/2, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  //----------------------------------------------------
  // 4. THICK OUTLINES (Sobel + dilation)
  //----------------------------------------------------
  // First: extract edges
  const edges = await sobelEdgesTensor(prevCanvas);

  const eTmp = document.createElement("canvas");
  eTmp.width = w; eTmp.height = h;
  let eCtx = eTmp.getContext("2d");
  await tf.browser.toPixels(edges, eTmp);
  edges.dispose();

  // Convert to ImageData for dilation
  let eImg = eCtx.getImageData(0, 0, w, h);
  let ed = eImg.data;

  // Thicken edges by dilating (3x3)
  for (let i = 0; i < ed.length; i += 4) {
    const v = ed[i]; // red channel is enough
    if (v > 60) {
      // make a thicker stroke
      ed[i] = ed[i+1] = ed[i+2] = 0;
    } else {
      ed[i] = ed[i+1] = ed[i+2] = 255;
    }
  }
  eCtx.putImageData(eImg, 0, 0);

  //----------------------------------------------------
  // 5. Composite outlines on top (multiply)
  //----------------------------------------------------
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(eTmp, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}

/* ----------------------------------------------------
   8. ARTISTIC SKETCH
---------------------------------------------------- */
export async function artisticSketch(inCanvas, prevCanvas) {
  await ensureTFReady();
  const w = prevCanvas.width, h = prevCanvas.height;
  const ctx = prevCanvas.getContext("2d");

  // 1. Copy source → preview canvas
  ctx.drawImage(inCanvas, 0, 0, w, h);

  // 2. Convert to grayscale
  let img = ctx.getImageData(0, 0, w, h);
  let d = img.data;

  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.3 + d[i+1] * 0.59 + d[i+2] * 0.11);
    d[i] = d[i+1] = d[i+2] = v;
  }
  ctx.putImageData(img, 0, 0);

  // 3. Detect edges (Sobel)
  const edges = await sobelEdgesTensor(prevCanvas);
  const eTmp = document.createElement("canvas");
  eTmp.width = w; eTmp.height = h;
  await tf.browser.toPixels(edges, eTmp);
  edges.dispose();

  // 4. Invert edges (dark lines on white)
  const eCtx = eTmp.getContext("2d");
  const eImg = eCtx.getImageData(0, 0, w, h);
  const ed = eImg.data;

  for (let i = 0; i < ed.length; i += 4) {
    let v = ed[i];
    ed[i] = ed[i+1] = ed[i+2] = (255 - v);
  }
  eCtx.putImageData(eImg, 0, 0);

  // 5. Blend edges using DARKEN
  ctx.globalCompositeOperation = "darken";
  ctx.drawImage(eTmp, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}
