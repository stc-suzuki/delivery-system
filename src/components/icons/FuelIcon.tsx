export default function FuelIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <line x1="3" y1="21" x2="15" y2="21" />
      <path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" />
      <line x1="5" y1="10" x2="15" y2="10" />
      <path d="M15 8l3 2v6a1.5 1.5 0 0 0 3 0v-4.5L18.5 8" />
    </svg>
  );
}
