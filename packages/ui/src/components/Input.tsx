import "../globals.css";

export default function Input({ defValue }: { defValue?: string }) {
  return (
    <div className="text-red-600">
      <input type="text" defaultValue={defValue} className="bg-yellow-500" />
      <br />
      <button className="bg-red-500 text-white p-4">UI Button</button>
    </div>
  );
}
