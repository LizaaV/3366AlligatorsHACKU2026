/** Labelled range input with its current value shown alongside. */

export const Slider = ({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; unit: string;
}) => (
  <label className="field" style={{ flex: 1, minWidth: 200 }}>
    <span className="row" style={{ justifyContent: 'space-between' }}>
      <span>{label}</span>
      <span className="ink">{value.toLocaleString()} {unit}</span>
    </span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
  </label>
);
