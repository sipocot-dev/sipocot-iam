import { connection } from 'next/server';

export default async function Home() {
  // Render per request so the CSP nonce set in proxy.ts applies.
  await connection();
  return (
    <main>
      <h1>Sipocot IAM</h1>
      <p>Identity &amp; Access Management service. This is an API-first application.</p>
      <ul>
        <li>
          REST API: <code>/api/v1</code> — see <code>docs/api.md</code>
        </li>
        <li>
          Health: <code>/api/health/live</code> · <code>/api/health/ready</code>
        </li>
      </ul>
    </main>
  );
}
