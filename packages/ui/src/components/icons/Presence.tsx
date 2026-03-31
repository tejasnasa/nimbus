export default function Presence({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M13 4.06189C18.0533 4.55399 22 8.81319 22 14C22 16.0719 21.3552 17.9957 20.2522 19.5843L17.8792 17.2114C18.5834 16.304 19 15.2012 19 14C19 10.6863 16.3137 8 13 8V11L8 6.5L13 2V4.06189ZM11 19.9381C5.94668 19.446 2 15.1868 2 10C2 7.92813 2.64484 6.00434 3.74782 4.41573L6.12078 6.78862C5.41662 7.69602 5 8.79881 5 10C5 13.3137 7.68629 16 11 16V13L16 17.5L11 22V19.9381Z" />
    </svg>
  );
}
