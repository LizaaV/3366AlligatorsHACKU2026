"""Docker sandbox runner (SANDBOX_IMPL=docker, opt-in; BUILD-PLAN M4 step 2, HANDOFF B2.1).

Same protocol as the subprocess runner: the unchanged `sandbox_child` runs inside the
`earth-sandbox` image (`backend/sandbox/Dockerfile`), job on stdin, `@@RESULT`/`@@ERROR` on stdout.
Differences:
- the container has no network except the internal `earth-only` one, no host files, no secrets,
  a read-only root FS, a non-root user and CPU / memory / pids limits (`docker_run_args`);
- `earth` in there is `earth/client.py`: each call goes to the earth service
  (`app/services/earth_service.py`) with a per-run token, and the call log comes from the
  service, never from the container's stdout.
Needs the `docker` CLI and the image (`docker build -f sandbox/Dockerfile -t earth-sandbox .`).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import secrets
import subprocess

from app.services import earth_service
from app.services.sandbox import OnCall, RunOutcome, drive_child, job_json, outcome
from earth.types import EarthCall

DOCKER = "docker"
SANDBOX_UID = "10001:10001"
OOM_EXIT = 137  # SIGKILL: the memory cgroup killed the script (timeouts are handled first)


def docker_run_args(name: str, image: str, network: str, cmd: list[str] | None = None) -> list[str]:
    """`docker run` flags for one untrusted script. Values of the -e vars come from the CLI env."""
    return [
        "run",
        "-i",
        "--rm",
        "--name",
        name,
        "--pull",
        "never",
        "--network",
        network,
        "--memory",
        "1g",
        "--memory-swap",
        "1g",
        "--cpus",
        "1",
        "--pids-limit",
        "128",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,size=64m,noexec,nosuid,nodev",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        SANDBOX_UID,
        "--label",
        "earth-sandbox=1",
        "-e",
        "RUN_ID",
        "-e",
        "EARTH_SERVICE_URL",
        "-e",
        "EARTH_TOKEN",
        image,
        *(cmd or []),
    ]


def docker_cli_env(**extra: str) -> dict[str, str]:
    """Env for the docker CLI (trusted, host side): only what it needs to find the daemon."""
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME") or k.startswith("DOCKER_")}
    env.update(extra)
    return env


async def run_in_docker(
    script: str, params: dict, run_id: str, on_call: OnCall | None, timeout_s: int
) -> RunOutcome:
    from app.core.config import settings

    await asyncio.to_thread(
        earth_service.ensure_started, settings.earth_service_host, settings.earth_service_port
    )
    session = earth_service.open_session(run_id)
    calls: list[EarthCall] = []

    async def pump() -> None:  # trusted call log → on_call, in order
        while True:
            call = await session.queue.get()
            try:
                calls.append(call)
                if on_call:
                    with contextlib.suppress(Exception):  # a UI hiccup must not kill the run
                        await on_call(call)
            finally:
                session.queue.task_done()

    pump_task = asyncio.create_task(pump())
    name = f"earth-run-{run_id}-{secrets.token_hex(4)}"
    killed = False

    try:
        proc = await asyncio.create_subprocess_exec(
            DOCKER,
            *docker_run_args(name, settings.sandbox_image, settings.sandbox_network),
            env=docker_cli_env(
                RUN_ID=run_id,
                EARTH_SERVICE_URL=settings.earth_service_url,
                EARTH_TOKEN=session.token,
            ),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=64 * 1024 * 1024,
        )

        def kill() -> None:
            nonlocal killed
            if proc.returncode is not None or killed:
                return
            killed = True
            with contextlib.suppress(OSError):  # the container outlives its CLI: kill it too
                subprocess.Popen(  # noqa: S603
                    [DOCKER, "kill", name],
                    env=docker_cli_env(),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            with contextlib.suppress(ProcessLookupError):
                proc.kill()

        final, timed_out, stderr = await drive_child(
            proc, job_json(script, params, run_id, timeout_s), timeout_s, None, kill
        )
    finally:
        earth_service.close_session(session)
        await asyncio.sleep(0)  # let call_soon_threadsafe callbacks land
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(session.queue.join(), 5)
        pump_task.cancel()

    code = proc.returncode
    return outcome(
        final,
        calls,
        timed_out,
        timeout_s,
        code,
        stderr,
        oom=code == OOM_EXIT and not killed,
    )
