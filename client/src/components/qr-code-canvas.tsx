import { useEffect, useRef } from "react";

/**
 * Tiny wrapper around the `qrcode` library that renders a QR code into a
 * `<canvas>`. Dynamically imports the library so the ~40 KB dependency never
 * lands in the critical path of the authenticated app; the canvas is redrawn
 * whenever `value`, `size`, or `margin` changes.
 *
 * The canvas is transparent by default — wrap it in a `bg-white` container
 * so phone cameras can reliably detect the finder patterns in dark mode.
 */
export function QrCodeCanvas({
  value,
  size = 200,
  margin = 2,
}: {
  value: string;
  size?: number;
  margin?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then((QRCode) => {
      if (cancelled || !canvasRef.current || !value) return;
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin,
        errorCorrectionLevel: "M",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [value, size, margin]);

  return <canvas ref={canvasRef} />;
}
