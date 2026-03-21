export default function Input({ defValue }: { defValue?: string }) {
  return <input type="text" defaultValue={defValue} />;
}
