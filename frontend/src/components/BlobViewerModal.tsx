import { useMemo } from 'react';
import { Copy, Download, Eye, FileText } from 'lucide-react';
import type { CellValue, ColumnInfo } from '../types';
import {
  blobInfo,
  bytesToBase64,
  formatByteSize,
  hexDump,
  type BlobInfo,
} from '../lib/grid';
import { useAppStore } from '../store/appStore';
import { Modal } from './ui';

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 400_000));
    const sample = text.slice(0, 4000);
    const printable = Array.from(sample).filter((char) => char >= ' ' || char === '\n' || char === '\t' || char === '\r').length;
    if (sample.length > 0 && printable / sample.length < 0.85) return null;
    return text;
  } catch {
    return null;
  }
}

function downloadBlob(info: BlobInfo, filename: string) {
  const bytes = info.bytes ?? new TextEncoder().encode(info.text ?? '');
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy.buffer], { type: info.mime ?? 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function BlobViewerModal({
  open,
  column,
  value,
  filename,
  onClose,
}: {
  open: boolean;
  column: ColumnInfo | null;
  value: CellValue;
  filename: string;
  onClose: () => void;
}) {
  const toast = useAppStore((state) => state.toast);
  const info = useMemo(() => blobInfo(value), [value]);
  const text = useMemo(() => (info.text !== null ? info.text : info.bytes ? decodeUtf8(info.bytes) : null), [info]);
  const imageUrl = useMemo(() => {
    if (!info.bytes || !info.mime || !info.mime.startsWith('image/') || info.size > 12 * 1024 * 1024) return null;
    return `data:${info.mime};base64,${bytesToBase64(info.bytes)}`;
  }, [info]);

  if (!column) return null;

  const copyHex = async () => {
    if (!info.hex) return;
    try {
      await navigator.clipboard.writeText(info.hex);
      toast('success', '已复制十六进制内容');
    } catch {
      toast('error', '复制失败，请检查浏览器剪贴板权限');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`查看 ${column.name}`}
      subtitle={`${column.columnType || column.dataType} · ${formatByteSize(info.size)}${info.mime ? ` · ${info.mime}` : ''}`}
      width={820}
      footer={
        <>
          <div className="modal-footer-spacer" />
          <button type="button" className="btn" onClick={() => downloadBlob(info, filename)}>
            <Download size={14} /> 下载
          </button>
          {info.hex ? (
            <button type="button" className="btn" onClick={() => void copyHex()}>
              <Copy size={14} /> 复制 HEX
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            关闭
          </button>
        </>
      }
    >
      <div className="blob-viewer">
        {info.size === 0 ? (
          <div className="design-empty">
            <Eye size={15} /> 单元格为空。
          </div>
        ) : imageUrl ? (
          <div className="blob-preview">
            <img src={imageUrl} alt={`${column.name} 预览`} />
          </div>
        ) : text !== null ? (
          <div className="blob-text-preview">
            <div className="blob-section-title">
              <FileText size={13} /> 文本预览
            </div>
            <pre>{text}</pre>
          </div>
        ) : (
          <div className="design-empty">
            <Eye size={15} /> 二进制内容没有可显示的内嵌预览，可复制 HEX 或下载后查看。
          </div>
        )}
        {info.hex ? (
          <div className="blob-hex">
            <div className="blob-section-title">十六进制</div>
            <pre>{hexDump(info.hex)}</pre>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
