'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import PiggyGuide from './piggy-guide';

export default function GuideLauncher() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className="text-button guide-launcher"
        onClick={() => setOpen(true)}
      >
        서비스 안내
      </button>
      {open && (
        <PiggyGuide
          onClose={() => setOpen(false)}
          onStart={(target) => {
            setOpen(false);
            router.push(`/auth?next=${target}`);
          }}
        />
      )}
    </>
  );
}
