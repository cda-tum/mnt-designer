"""Run native SiDB gate design on a layout snapshot with a hard time limit."""

import argparse
import subprocess
import sys
from pathlib import Path

import mnt.pyfiction as fiction

MODES = ("QUICKCELL", "AUTOMATIC_EXHAUSTIVE_GATE_DESIGNER", "RANDOM")
TIMEOUT_SECONDS = 60
TIMEOUT_GRACE_SECONDS = 5
MAX_TIMEOUT_MS = (TIMEOUT_SECONDS - TIMEOUT_GRACE_SECONDS) * 1000


def available() -> bool:
    """Whether pyfiction provides circuit design with a native timeout."""
    return hasattr(fiction, "on_the_fly_sidb_circuit_design") and hasattr(
        getattr(fiction, "on_the_fly_sidb_circuit_design_params", None), "timeout"
    )


def write_layout(
    layout: fiction.cartesian_gate_layout,
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
    fiction.write_fgl_layout(layout.clone(), str(source))
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
    layout = fiction.read_cartesian_fgl_layout(args.source)
    _, errors = fiction.gate_level_drvs(layout, print_report=False)
    if errors:
        return 3
    try:
        hex_layout = fiction.hexagonalization(layout)
        params = fiction.on_the_fly_sidb_circuit_design_params()
        # One native deadline covers all gates and their nested simulations.
        params.timeout = args.timeout
        library_params = params.sidb_on_the_fly_gate_library_parameters
        gate_params = library_params.design_gate_params
        gate_params.number_of_canvas_sidbs = args.count
        gate_params.design_mode = getattr(fiction.design_sidb_gates_mode, args.mode)
        gate_params.maximal_random_design_attempts = 10_000
        physical = gate_params.operational_params.simulation_parameters
        for name in ("epsilon_r", "lambda_tf", "mu_minus", "base"):
            value = getattr(args, name)
            if value != getattr(physical, name):
                # Predefined crossings are not rechecked under changed physical conditions.
                library_params.using_predefined_crossing_and_double_wire_if_possible = (
                    fiction.sidb_complex_gate_design_policy.DESIGN_ON_THE_FLY
                )
            setattr(physical, name, value)
        circuit = fiction.on_the_fly_sidb_circuit_design(hex_layout, params)
    except TimeoutError:
        return 4
    except (RuntimeError, ValueError):
        return 2
    if Path(args.output).suffix == ".sqd":
        fiction.write_sqd_layout(circuit, args.output)
    else:
        svg_params = fiction.write_sidb_layout_svg_params()
        svg_params.color_background = fiction.color_mode.DARK
        fiction.write_sidb_layout_svg(circuit, args.output, svg_params)
    return 0


if __name__ == "__main__":
    sys.exit(main())
