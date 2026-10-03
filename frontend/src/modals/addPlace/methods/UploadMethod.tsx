/** Locate from an uploaded boundary file. The outline is parsed server-side. */

import { useEffect, useRef, useState } from 'react';
import { ApiError, api, toApiError } from '../../../api';
import type { ParseBoundaryFileResponse } from '../../../api/types';
import { ErrorState } from '../../../components/async';
import { IconBtn, Ms } from '../../../components/ui';
import { ringToPts } from '../../../lib/geo';
import type { MethodProps } from '../types';

export function UploadMethod({ onChange }: MethodProps) {
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploaded, setUploaded] = useState<ParseBoundaryFileResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange(
      uploaded && file
        ? {
            lat: uploaded.center.lat,
            lon: uploaded.center.lon,
            label: uploaded.suggestedName,
            source: 'uploaded',
            via: file.name,
            pts: ringToPts(uploaded.geometry.coordinates[0] ?? [], uploaded.center),
            givenLabel: uploaded.note,
            details: [{ label: 'File', value: file.name }],
          }
        : null,
    );
  }, [uploaded, file, onChange]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setFile({ name: f.name, size: f.size });
    setParsing(true);
    setUploaded(null);
    setError(null);
    try {
      setUploaded(await api.places.parseBoundaryFile(f));
    } catch (err) {
      setError(toApiError(err));
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <input ref={fileRef} type="file" hidden accept=".kml,.kmz,.geojson,.json,.csv,.gpx" onChange={(e) => pickFile(e.target.files?.[0])} />
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
        style={{
          border: `1px dashed ${dragOver ? '#fff' : 'var(--hair)'}`, borderRadius: 'var(--r)', padding: '28px 16px', background: dragOver ? 'var(--s2)' : 'var(--canvas)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', cursor: 'pointer',
        }}
      >
        <Ms n="upload_file" size={28} className="muted" />
        <div className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>Drop a file here or click to choose</div>
        <div className="caption">GeoJSON, KML/KMZ, GPX or CSV with lat/lon columns</div>
      </div>
      {error && <ErrorState error={error} title="That file could not be read" compact />}
      {file && (
        <div className="well row" style={{ padding: '10px 14px', gap: 10 }}>
          <Ms n="description" className="muted" />
          <div className="grow">
            <div className="ink body-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
            {/* The server describes what it found; the old copy guessed from the extension and
                printed a hardcoded "14 points found". */}
            <div className="tiny">{parsing ? 'Reading file…' : (uploaded?.note ?? 'Read') + ` · ${fmtSize(file.size)}`}</div>
          </div>
          {parsing ? <span className="spinner" /> : <Ms n="check_circle" style={{ color: 'var(--green)' }} />}
          <IconBtn icon="close" className="sm" aria-label="Remove file" onClick={() => { setFile(null); setUploaded(null); if (fileRef.current) fileRef.current.value = ''; }} />
        </div>
      )}
    </div>
  );
}

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
