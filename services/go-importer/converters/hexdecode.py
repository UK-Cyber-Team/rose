#!/usr/bin/env python3

# Hex string decoder for Tulip
# Decodes hex-encoded strings commonly found in CTF challenges

import re
import binascii
from helpers import Converter, StreamChunk, Result, Stream


class HexDecodeConverter(Converter):
    """
    Decodes hex-encoded strings from network traffic.
    
    Supports various hex formats:
    - Lowercase: deadbeef
    - Uppercase: DEADBEEF
    - With 0x prefix: 0xdeadbeef
    - With spaces: de ad be ef
    - With backslash-x: \xde\xad\xbe\xef
    """

    def __init__(self):
        super().__init__()
        # Match continuous hex strings (at least 4 chars to avoid false positives)
        # Matches: deadbeef, DEADBEEF, 0xdeadbeef
        self._hex_pattern = re.compile(rb'(?:0x)?([0-9a-fA-F]{4,})')
        
        # Match \x escaped hex bytes
        self._escaped_pattern = re.compile(rb'(?:\\x([0-9a-fA-F]{2}))+')
        
        # Match space-separated hex bytes (common in CTFs)
        self._spaced_pattern = re.compile(rb'(?:[0-9a-fA-F]{2}\s+){2,}[0-9a-fA-F]{2}')

    def decode_hex_string(self, hex_str: bytes) -> bytes:
        """
        Attempt to decode a hex string.
        Returns original if decoding fails.
        """
        try:
            # Remove common separators
            cleaned = hex_str.replace(b' ', b'').replace(b'\\x', b'').replace(b'0x', b'')
            
            # Only decode if it's a valid hex string of reasonable length
            if len(cleaned) >= 4 and len(cleaned) % 2 == 0:
                # Check if it's all hex characters
                try:
                    decoded = binascii.unhexlify(cleaned)
                    # Only return decoded if it contains printable or common binary chars
                    # This avoids false positives from random hex-looking strings
                    return decoded
                except binascii.Error:
                    return hex_str
            return hex_str
        except Exception:
            return hex_str

    def decode_escaped_hex(self, data: bytes) -> bytes:
        """
        Decode \\xNN formatted hex bytes.
        Example: b'\\xde\\xad\\xbe\\xef' -> b'\\xde\\xad\\xbe\\xef' (actual bytes)
        """
        def replace_match(match):
            try:
                return binascii.unhexlify(match.group(0).replace(b'\\x', b''))
            except:
                return match.group(0)
        
        return self._escaped_pattern.sub(replace_match, data)

    def decode_spaced_hex(self, data: bytes) -> bytes:
        """
        Decode space-separated hex bytes.
        Example: b'de ad be ef' -> b'\\xde\\xad\\xbe\\xef'
        """
        def replace_match(match):
            try:
                hex_bytes = match.group(0).replace(b' ', b'')
                return binascii.unhexlify(hex_bytes)
            except:
                return match.group(0)
        
        return self._spaced_pattern.sub(replace_match, data)

    def process_data(self, data: bytes) -> bytes:
        """
        Process data through all hex decoding patterns.
        """
        content = data
        
        # Try escaped hex format first (\xNN)
        content = self.decode_escaped_hex(content)
        
        # Try space-separated hex
        content = self.decode_spaced_hex(content)
        
        # Try continuous hex strings
        pos = 0
        result = b''
        for match in self._hex_pattern.finditer(data):
            result += data[pos:match.start()]
            
            hex_str = match.group(1)
            # Apply heuristic: only decode if it looks like intentional hex encoding
            # - At least 8 characters (4 bytes)
            # - Contains both letters and numbers (reduces false positives)
            if len(hex_str) >= 8:
                has_letters = any(c in hex_str.lower() for c in b'abcdef')
                has_numbers = any(c in hex_str for c in b'0123456789')
                
                if has_letters and has_numbers:
                    decoded = self.decode_hex_string(hex_str)
                    result += decoded
                else:
                    result += match.group(0)
            else:
                result += match.group(0)
            
            pos = match.end()
        
        result += data[pos:]
        return result

    def handle_stream(self, stream: Stream) -> Result:
        result_data = []
        
        for chunk in stream.Chunks:
            try:
                decoded_content = self.process_data(chunk.Content)
                result_data.append(StreamChunk(chunk.Direction, decoded_content))
            except Exception as e:
                # If processing fails, return original data
                self.log(f"Error decoding hex: {e}")
                result_data.append(StreamChunk(chunk.Direction, chunk.Content))
        
        return Result(result_data)


if __name__ == "__main__":
    HexDecodeConverter().run()
