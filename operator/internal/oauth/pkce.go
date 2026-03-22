package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// GeneratePKCE generates a PKCE code verifier and challenge.
// Uses crypto/rand for the verifier and SHA-256 for the challenge.
func GeneratePKCE() (verifier, challenge string, err error) {
	// 32 random bytes for verifier
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	verifier = base64URLEncode(buf)

	// SHA-256 hash of verifier
	hash := sha256.Sum256([]byte(verifier))
	challenge = base64URLEncode(hash[:])

	return verifier, challenge, nil
}

func base64URLEncode(data []byte) string {
	return base64.RawURLEncoding.EncodeToString(data)
}
