import React from 'react';

interface BrandLogoProps {
  size?: 'sm' | 'md';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 'md' }) => {
  const iconDim = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const textClass = size === 'sm' ? 'text-base' : 'text-lg';

  return (
    <span className={`inline-flex items-center gap-2.5 font-display font-bold tracking-tight text-[#F3F4F8] whitespace-nowrap shrink-0 ${textClass}`}>
      <svg
        className={`${iconDim} shrink-0 text-violet-500`}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Clapperboard top angled bar */}
        <path
          d="M5 9.5L25.5 5.2C26.6 4.97 27.68 5.68 27.91 6.78L28.5 9.6L4.6 14.6L4 11.78C3.77 10.68 4.48 9.6 5 9.5Z"
          fill="currentColor"
        />
        {/* Clapper stripes */}
        <path d="M9.5 8.5L12.5 12.9M16.5 7.1L19.5 11.5M23 5.8L25.8 10.1" stroke="#09090F" strokeWidth="2" strokeLinecap="round" />
        {/* Main cinema screen body */}
        <rect x="4" y="13" width="24" height="15" rx="3" fill="#141422" stroke="currentColor" strokeWidth="2" />
        {/* Synchronized Play Triangle inside clapperboard */}
        <path
          d="M13.5 17.3L19.8 20.5L13.5 23.7V17.3Z"
          fill="#A78BFA"
          stroke="#A78BFA"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
      <span>FriendsFlix</span>
    </span>
  );
};
