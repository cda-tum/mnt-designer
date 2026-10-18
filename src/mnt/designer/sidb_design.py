"""Run native SiDB gate design on a layout snapshot with a hard time limit."""

import argparse
import subprocess
import sys
from pathlib import Path

from mnt.pyfiction.layouts import cartesian_gate_layout
from mnt.pyfiction.layouts.io import read_fgl_layout, write_fgl_layout
from mnt.pyfiction.physical_design import hexagonalization
from mnt.pyfiction.sidb import generators
from mnt.pyfiction.sidb.io import color_mode, write_sidb_layout_svg, write_sqd_layout
from mnt.pyfiction.verification import gate_level_drvs

MODES = ("QUICKCELL", "AUTOMATIC_EXHAUSTIVE_GATE_DESIGNER", "RANDOM")
TIMEOUT_SECONDS = 60
TIMEOUT_GRACE_SECONDS = 5
MAX_TIMEOUT_MS = (TIMEOUT_SECONDS - TIMEOUT_GRACE_SECONDS) * 1000


def available() -> bool:
    """Whether pyfiction provides circuit design with a native timeout."""
    return callable(getattr(generators, "on_the_fly_sidb_circuit_design", None))


def write_layout(
    layout: cartesian_gate_layout,
    filename: str,
    count: int,
    mode: str,
    epsilon_r: float,
    lambda_tf: float,
    mu_minus: float,
    base: int,
    timeout: int = MAX_TIMEOUT_MS,
) -> None:
    """Export a snapshot and isolate the native search in a killable process."""
    source = Path(filename).with_name("input.fgl")
    # The native writer releases the GIL; isolate the snapshot before editing can resume.
    write_fgl_layout(layout.clone(), str(source))
    subprocess.run(
        [
            sys.executable,
            "-m",
            "mnt.designer.sidb_design",
            str(source),
            filename,
            str(count),
            mode,
            f"--epsilon-r={epsilon_r}",
            f"--lambda-tf={lambda_tf}",
            f"--mu-minus={mu_minus}",
            f"--base={base}",
            f"--timeout={timeout}",
        ],
        check=True,
        timeout=timeout / 1000 + TIMEOUT_GRACE_SECONDS,
        capture_output=True,
    )


def main() -> int:
    """Design gates for the private FGL snapshot and write SVG or SiQAD output."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("count", type=int, choices=range(1, 4))
    parser.add_argument("mode", choices=MODES)
    parser.add_argument("--epsilon-r", type=float, default=5.6)
    parser.add_argument("--lambda-tf", type=float, default=5.0)
    parser.add_argument("--mu-minus", type=float, default=-0.32)
    parser.add_argument("--base", type=int, choices=(2, 3), default=3)
    parser.add_argument(
        "--timeout", type=int, default=MAX_TIMEOUT_MS, help="Whole-circuit search budget in milliseconds"
    )
    args = parser.parse_args()
    if not 1 <= args.timeout <= MAX_TIMEOUT_MS:
        parser.error(f"timeout must be between 1 and {MAX_TIMEOUT_MS} milliseconds")
    layout = read_fgl_layout(args.source)
    _, errors = gate_level_drvs(layout, print_report=False)
    if errors:
        return 3
    try:
        hex_layout = hexagonalization(layout)
        policy = generators.sidb_complex_gate_design_policy.USING_PREDEFINED
        if (args.epsilon_r, args.lambda_tf, args.mu_minus, args.base) != (5.6, 5.0, -0.32, 3):
            # Predefined crossings are not rechecked under changed physical conditions.
            policy = generators.sidb_complex_gate_design_policy.DESIGN_ON_THE_FLY
        circuit = generators.on_the_fly_sidb_circuit_design(
            hex_layout,
            # One native deadline covers all gates and their nested simulations.
            timeout=args.timeout,
            number_of_canvas_sidbs=args.count,
            design_mode=getattr(generators.design_sidb_gates_mode, args.mode),
            maximal_random_design_attempts=10_000,
            epsilon_r=args.epsilon_r,
            lambda_tf=args.lambda_tf,
            mu_minus=args.mu_minus,
            base=args.base,
            using_predefined_crossing_and_double_wire_if_possible=policy,
        )
    except TimeoutError:
        return 4
    except (RuntimeError, ValueError):
        return 2
    if Path(args.output).suffix == ".sqd":
        write_sqd_layout(circuit, args.output)
    else:
        write_sidb_layout_svg(circuit, args.output, color_background=color_mode.DARK)
    return 0


if __name__ == "__main__":
    sys.exit(main())
