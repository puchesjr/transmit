import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

// Raw Ed25519 public keys need the SPKI DER prefix before node:crypto accepts them.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function verifyTelnyxWebhook(
	rawBody: string,
	signature: string | null,
	timestamp: string | null
): boolean {
	const publicKeyB64 = process.env.TELNYX_PUBLIC_KEY;
	if (!publicKeyB64 || !signature || !timestamp) return false;
	try {
		const key = createPublicKey({
			key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyB64, 'base64')]),
			format: 'der',
			type: 'spki'
		});
		return cryptoVerify(
			null,
			Buffer.from(`${timestamp}|${rawBody}`),
			key,
			Buffer.from(signature, 'base64')
		);
	} catch {
		return false;
	}
}
