'use client';

import { useEffect, useRef } from 'react';

const JAPANESE = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const BINARY = '01';
const CHARS = JAPANESE + BINARY;

export function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let columns: number[] = [];

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const columnWidth = 18;
      const count = Math.floor(canvas.width / columnWidth);
      columns = Array.from({ length: count }, () => Math.random() * canvas.height);
    }

    resize();
    window.addEventListener('resize', resize);

    function draw() {
      if (!ctx || !canvas) return;

      ctx.fillStyle = 'rgba(9, 6, 0, 0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = '14px monospace';

      for (let i = 0; i < columns.length; i++) {
        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        const x = i * 18;
        const y = columns[i];

        const brightness = Math.random();
        if (brightness > 0.95) {
          ctx.fillStyle = '#fbbf24';
        } else if (brightness > 0.8) {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.6)';
        } else {
          ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
        }

        ctx.fillText(char, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          columns[i] = 0;
        }
        columns[i] += 18;
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: '#090600' }}
    />
  );
}
