"""Local-dev relay: earth-only network → the earth service on the host (Docker Desktop).

An `internal` Docker network cannot reach the host, so locally a relay container (this file, in
the sandbox image) joins both the default bridge and `earth-only`, and forwards TCP :8701 to
TARGET (default host.docker.internal:8701). It forwards to that one address only.
Not used in compose: there the backend container itself sits on `earth-only`.
"""

import asyncio
import os

LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8701"))
TARGET_HOST, _, TARGET_PORT = os.environ.get("TARGET", "host.docker.internal:8701").rpartition(":")


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        writer.close()


async def _handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        up_reader, up_writer = await asyncio.open_connection(TARGET_HOST, int(TARGET_PORT))
    except OSError:
        writer.close()
        return
    await asyncio.gather(_pipe(reader, up_writer), _pipe(up_reader, writer))


async def main() -> None:
    server = await asyncio.start_server(_handle, "0.0.0.0", LISTEN_PORT)  # noqa: S104
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
