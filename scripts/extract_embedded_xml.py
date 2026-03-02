from pathlib import Path
import zlib

pdf_path = Path('artifacts/zugferd-embedded-demo.pdf')
out_path = Path('artifacts/factur-x.xml')

pdf = pdf_path.read_bytes()
marker = b'/Subtype /text#2Fxml'
pos = pdf.find(marker)
if pos < 0:
    raise SystemExit('No xml subtype marker found in PDF')

start_obj = pdf.rfind(b'obj', 0, pos)
start = pdf.rfind(b'\n', 0, start_obj)
if start < 0:
    start = 0

endstream = pdf.find(b'endstream', pos)
stream_pos = pdf.rfind(b'stream', pos, endstream)
if stream_pos < 0:
    raise SystemExit('No stream found near xml marker')

obj_chunk = pdf[start:endstream + len(b'endstream')]

stream_start = stream_pos + len(b'stream')
if pdf[stream_start:stream_start + 2] == b'\r\n':
    stream_start += 2
elif pdf[stream_start:stream_start + 1] in (b'\n', b'\r'):
    stream_start += 1

stream_data = pdf[stream_start:endstream]
while stream_data.endswith((b'\n', b'\r')):
    stream_data = stream_data[:-1]

if b'/FlateDecode' in obj_chunk:
    decoded = zlib.decompress(stream_data)
else:
    decoded = stream_data

out_path.write_bytes(decoded)
print(f'Extracted embedded XML to {out_path} ({len(decoded)} bytes)')
