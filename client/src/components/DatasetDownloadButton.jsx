import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { fetchContentDownload } from '../api/content.js';

export default function DatasetDownloadButton({
  itemId,
  label = 'View / Download',
  className = '',
  style,
  showIcon = true,
}) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (!itemId || loading) return;
    setLoading(true);
    const popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;

    try {
      const result = await fetchContentDownload(itemId);
      if (!result?.url) throw new Error('Download URL was not returned.');
      if (popup) popup.location.replace(result.url);
      else window.location.assign(result.url);
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      const accessState = err?.response?.data?.accessState;
      const message = accessState === 'login_required'
        ? 'Sign in to download this dataset.'
        : accessState === 'pending'
          ? 'Your dataset access request is still pending.'
          : accessState === 'rejected'
            ? 'Your dataset access request was not approved.'
            : accessState === 'request_required'
              ? 'Access approval is required to download this dataset.'
              : err?.response?.data?.error || err.message || 'Could not prepare the dataset download.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" onClick={handleDownload} disabled={loading} className={className} style={style}>
      {showIcon && <Download className="w-3.5 h-3.5" />}
      {loading ? 'Preparing…' : label}
    </button>
  );
}
