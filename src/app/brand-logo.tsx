'use client';

import Image from 'next/image';
import Link from 'next/link';

export default function BrandLogo({
  onClick,
  href = '/',
  className = '',
}: {
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const image = (
    <Image
      src="/brand/kkuljob-header.png"
      alt="꿀잡"
      width={1358}
      height={1159}
      priority
      unoptimized
    />
  );
  return onClick ? (
    <button
      type="button"
      className={`brand-logo ${className}`}
      onClick={onClick}
      aria-label="꿀잡 홈으로 이동"
    >
      <span className="brand-logo-image">
        {image}
        <span className="brand-logo-ink" aria-hidden="true" />
      </span>
    </button>
  ) : (
    <Link
      className={`brand-logo ${className}`}
      href={href}
      aria-label="꿀잡 홈으로 이동"
    >
      <span className="brand-logo-image">
        {image}
        <span className="brand-logo-ink" aria-hidden="true" />
      </span>
    </Link>
  );
}
