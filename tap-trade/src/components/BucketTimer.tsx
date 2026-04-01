import { useEffect, useState } from "react";

interface Props {
  bucketSeconds: number;
}

export function BucketTimer({ bucketSeconds }: Props) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const update = () => {
      const now = Date.now() / 1000;
      const boundary = Math.ceil(now / bucketSeconds) * bucketSeconds;
      setRemaining(Math.max(0, boundary - now));
    };
    update();
    const iv = setInterval(update, 100);
    return () => clearInterval(iv);
  }, [bucketSeconds]);

  const secs = Math.ceil(remaining);
  const display = `0:${secs.toString().padStart(2, "0")}`;

  return (
    <div className="absolute bottom-4 left-4 font-mono text-zinc-500 text-lg tracking-tight select-none">
      {display}
    </div>
  );
}
