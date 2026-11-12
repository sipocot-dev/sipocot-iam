'use client';

/** Last-resort boundary: replaces the root layout when it fails to render. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1.25rem', maxWidth: '44rem', margin: '0 auto' }}
      >
        <h1>Service error</h1>
        <p>The application failed to load{error.digest ? ` (reference ${error.digest})` : ''}.</p>
        <button type="button" onClick={reset}>
          Reload
        </button>
      </body>
    </html>
  );
}
