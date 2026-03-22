import "../globals.css";

export default function Input({ defValue, placeholder }: { defValue?: string; placeholder?: string }) {
  return (
    <input
      type="text"
      defaultValue={defValue}
      placeholder={placeholder}
      className="bg-(--card) h-10 w-80 rounded-md px-3 py-4 text-md focus-visible:outline-none focus-visible:ring-4 transition focus-visible:ring-(--ring)"
    />
  );
}
