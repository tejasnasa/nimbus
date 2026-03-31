export default function Star({classname}: {classname?: string}) {
  return (
    <svg
      className={classname}
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <path d="M12 18.26L4.94658 22.2082L6.52121 14.2799L0.587213 8.7918L8.61493 7.84006L12 0.5L15.3851 7.84006L23.4128 8.7918L17.4788 14.2799L19.0534 22.2082L12 18.26Z" />
    </svg>
  );
}
