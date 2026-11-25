function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

function bufferToBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function requestLocugardCredential(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new Error('Этот браузер не поддерживает WebAuthn / passkey.');
  }
  if (typeof options.challenge !== 'string') {
    throw new Error('LocuGard вернул некорректный WebAuthn challenge.');
  }

  const allowCredentials = Array.isArray(options.allowCredentials)
    ? options.allowCredentials.map((entry) => {
        const descriptor = entry as Record<string, unknown>;
        if (typeof descriptor.id !== 'string') {
          throw new Error('LocuGard вернул некорректный список passkey.');
        }
        return { ...descriptor, id: base64UrlToBuffer(descriptor.id) };
      })
    : undefined;
  const publicKey = {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    ...(allowCredentials ? { allowCredentials } : {}),
  } as unknown as PublicKeyCredentialRequestOptions;

  const credential = await navigator.credentials.get({ publicKey });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Браузер не вернул WebAuthn credential.');
  }
  const response = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
  };
}
