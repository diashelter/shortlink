import { readFileSync } from 'fs';
import { IncomingHttpHeaders } from 'http';
import * as https from 'https';
import { Agent } from 'https';

const DEFAULT_CA_PATH = '/certs/ca.crt';
const DEFAULT_HOSTNAME = 'nginx';
const DEFAULT_PORT = 443;
const DEFAULT_SERVERNAME = 'localhost';

export type TrustedHttpsResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: string;
};

export type TrustedHttpsRequestOptions = {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * Creates an HTTPS agent that trusts the Compose-generated local CA.
 * Does not disable TLS certificate validation.
 */
export function createTrustedHttpsAgent(
  caPath = process.env.TLS_CA_PATH ?? DEFAULT_CA_PATH,
): Agent {
  return new https.Agent({
    ca: readFileSync(caPath),
  });
}

export function trustedHttpsRequest(
  options: TrustedHttpsRequestOptions,
): Promise<TrustedHttpsResponse> {
  const agent = createTrustedHttpsAgent();
  const hostname = process.env.E2E_HTTPS_HOST ?? DEFAULT_HOSTNAME;
  const port = Number(process.env.E2E_HTTPS_PORT ?? DEFAULT_PORT);
  const servername = process.env.E2E_HTTPS_SERVERNAME ?? DEFAULT_SERVERNAME;

  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: servername,
      ...(options.headers ?? {}),
    };

    if (options.body !== undefined && headers['Content-Length'] === undefined) {
      headers['Content-Length'] = Buffer.byteLength(options.body).toString();
    }

    const request = https.request(
      {
        hostname,
        port,
        path: options.path,
        method: options.method ?? 'GET',
        agent,
        servername,
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    request.on('error', reject);

    if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}
