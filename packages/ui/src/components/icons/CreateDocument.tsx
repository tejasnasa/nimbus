export default function CreateDocument({className}: {className?: string}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M21 6.75736L19 8.75736V4H10V9H5V20H19V17.2426L21 15.2426V21C21 21.5523 20.5523 22 20 22H4C3.44772 22 3 21.5523 3 21V8L9.00319 2H20C20.5523 2 21 2.44772 21 3V6.75736ZM21.7782 8.80761L23.1924 10.2218L15.4142 18L13.9979 17.9979L14 16.5858L21.7782 8.80761Z" />
    </svg>
  );
}
