"""Small end-to-end checks against the installed pyfiction bindings."""

import io
from importlib.metadata import version
from xml.etree import ElementTree

import pytest

from mnt.designer import app as designer

VERILOG = """module top(a, b, y);
input a, b;
output y;
assign y = a & b;
endmodule
"""
EXPORTS = {
    "/export_layout": "layout.fgl",
    "/export_dot_layout": "layout.dot",
    "/export_qca_layout": "layout_qca.svg",
    "/export_sidb_layout": "layout_sidb.svg",
}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setitem(designer.app.config, "TESTING", True)
    for name in ("layouts", "networks", "verilogs"):
        monkeypatch.setattr(designer, name, {})
    with designer.app.test_client() as client:
        assert client.get("/").status_code == 200
        yield client


def post(client, route, payload=None, *, success=True):
    response = client.post(route, json=payload or {})
    assert response.is_json, response.get_data(as_text=True)
    result = response.get_json()
    assert result["success"] is success, result
    return result


@pytest.fixture
def placed(client):
    post(client, "/save_verilog_code", {"code": VERILOG})
    post(client, "/apply_orthogonal")
    return client


def test_design_workflow(placed):
    layout = placed.get("/get_layout").get_json()
    assert layout["success"]
    assert {gate["type"] for gate in layout["gates"]} >= {"pi", "and", "po"}
    assert placed.get("/get_verilog_code").get_json()["code"] == VERILOG
    assert post(placed, "/check_design_rules")["errors"] == 0
    assert post(placed, "/check_equivalence")["equivalence"] in {"STRONG", "WEAK"}
    optimized = post(
        placed,
        "/apply_optimization",
        {"timeout": 1000, "max_gate_relocations": 1, "optimize_pos_only": False, "planar_optimization": True},
    )
    assert optimized["gates"]
    assert post(placed, "/check_equivalence")["equivalence"] in {"STRONG", "WEAK"}


def test_exports_and_fgl_roundtrip(placed, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    original = placed.get("/get_layout").get_json()
    exports = {}
    for route, filename in EXPORTS.items():
        response = placed.get(route)
        assert response.status_code == 200
        assert filename in response.headers["Content-Disposition"]
        assert response.data
        exports[route] = response.data
        if filename.endswith(".svg"):
            assert response.mimetype == "image/svg+xml"
            assert ElementTree.fromstring(response.data).tag.endswith("svg")
    assert not list(tmp_path.iterdir())
    post(placed, "/reset_layout", {"x": 2, "y": 2})
    imported = placed.post("/import_layout", data={"file": (io.BytesIO(exports["/export_layout"]), "example.fgl")})
    assert imported.get_json()["success"]
    assert placed.get("/get_layout").get_json() == original


def test_missing_layout_exports_and_session_isolation(placed):
    other = designer.app.test_client()
    assert other.get("/").status_code == 200
    for route in EXPORTS:
        response = other.get(route)
        assert response.status_code < 500
        assert response.is_json and response.get_json()["success"] is False
    assert other.get("/get_verilog_code").get_json()["success"] is False
    post(other, "/reset_layout", {"x": 2, "y": 3})
    assert other.get("/get_layout").get_json()["gates"] == []
    assert placed.get("/get_layout").get_json()["gates"]
    assert designer.app.secret_key != "your_secret_key"


@pytest.mark.parametrize(
    "route,extra_file",
    [
        ("/import_layout", False),
        ("/import_verilog_code", False),
        ("/save_verilog_code", False),
        ("/import_verilog_code", True),
    ],
)
def test_oversized_uploads_rejected_before_parsing(placed, monkeypatch, route, extra_file):
    original = placed.get("/get_layout").get_json()
    assert designer.app.config["MAX_CONTENT_LENGTH"] == 5 * 1024 * 1024
    monkeypatch.setitem(designer.app.config, "MAX_CONTENT_LENGTH", 1024)

    def unexpected_parse(*args, **kwargs):
        pytest.fail("Oversized requests must be rejected before file streams or native parsing")

    monkeypatch.setattr(designer.app.request_class, "_get_file_stream", unexpected_parse)
    monkeypatch.setattr(designer, "read_cartesian_fgl_layout", unexpected_parse)
    monkeypatch.setattr(designer, "read_technology_network", unexpected_parse)
    if route == "/save_verilog_code":
        response = placed.post(route, json={"code": "x" * 2048})
    else:
        filename = "example.fgl" if route == "/import_layout" else "example.v"
        data = {"file": (io.BytesIO(VERILOG.encode() if extra_file else b"x" * 2048), filename)}
        if extra_file:
            data["ignored"] = (io.BytesIO(b"x" * 2048), "unused.bin")
        response = placed.post(route, data=data)
    assert response.status_code == 413
    assert response.is_json
    assert response.get_json()["success"] is False
    assert response.get_json()["error"]
    assert placed.get("/get_layout").get_json() == original
    assert placed.get("/get_verilog_code").get_json()["code"] == VERILOG


def test_import_verilog_and_safe_layout_edits(client):
    imported = client.post("/import_verilog_code", data={"file": (io.BytesIO(VERILOG.encode()), "example.v")})
    assert imported.get_json() == {"success": True, "code": VERILOG}
    post(client, "/create_layout", {"x": 3, "y": 3})
    for x, y in ((0, 0), (2, 2)):
        post(client, "/place_gate", {"x": x, "y": y, "gate_type": "pi", "params": {}})
    original = client.get("/get_layout").get_json()
    post(client, "/create_layout", {"x": 2, "y": 2}, success=False)
    for route in ("/create_layout", "/reset_layout"):
        post(client, route, {"x": 0, "y": 3}, success=False)
    post(
        client,
        "/move_gate",
        {"source_x": 0, "source_y": 0, "source_gate_type": "pi", "target_x": 2, "target_y": 2},
        success=False,
    )
    assert client.get("/get_layout").get_json() == original
    post(
        client,
        "/move_gate",
        {"source_x": 0, "source_y": 0, "source_gate_type": "pi", "target_x": 1, "target_y": 0},
    )
    post(client, "/delete_gate", {"x": 1, "y": 0})
    assert len(client.get("/get_layout").get_json()["gates"]) == 1


def test_disconnected_crossing_remains_readable(client):
    post(client, "/create_layout", {"x": 3, "y": 3})
    for x, y in ((0, 1), (1, 0)):
        post(client, "/place_gate", {"x": x, "y": y, "gate_type": "pi", "params": {}})
    post(
        client,
        "/place_gate",
        {
            "x": 1,
            "y": 1,
            "gate_type": "bufc",
            "params": {
                "first": {"position": {"x": 0, "y": 1}, "gate_type": "pi"},
                "second": {"position": {"x": 1, "y": 0}, "gate_type": "pi"},
            },
        },
    )
    result = client.get("/get_layout").get_json()
    assert result["success"] and len(result["gates"]) == 3


@pytest.mark.parametrize("multithreading", [False, True])
def test_gold_forwards_multithreading(placed, monkeypatch, multithreading):
    run_gold = designer.graph_oriented_layout_design

    def capture(network, params):
        assert params.enable_multithreading is multithreading
        return run_gold(network, params)

    monkeypatch.setattr(designer, "graph_oriented_layout_design", capture)
    result = post(
        placed,
        "/apply_gold",
        {
            "return_first": True,
            "mode": "HIGH_EFFICIENCY",
            "timeout": 1000,
            "num_vertex_expansions": 1,
            "planar": True,
            "cost": "AREA",
            "enable_multithreading": multithreading,
        },
    )
    assert result["gates"]


def test_zero_relocations_is_forwarded(placed, monkeypatch):
    def capture(layout, params):
        assert params.max_gate_relocations == 0

    monkeypatch.setattr(designer, "post_layout_optimization", capture)
    post(placed, "/apply_optimization", {"timeout": 1000, "max_gate_relocations": 0})


def test_exact_defaults_and_unavailable_solver(placed, monkeypatch):
    if designer.exact_params is not None:
        defaults = designer.exact_params()

        def capture(network, params):
            assert params.upper_bound_x == defaults.upper_bound_x
            assert params.upper_bound_y == defaults.upper_bound_y
            return designer.orthogonal(network)

        monkeypatch.setattr(designer, "exact_cartesian", capture)
        assert post(placed, "/apply_exact", {"timeout": 1000})["gates"]
    monkeypatch.setattr(designer, "exact_params", None)
    monkeypatch.setattr(designer, "exact_cartesian", None)
    assert "Z3" in post(placed, "/apply_exact", success=False)["error"]


def test_cli(monkeypatch, capsys):
    with pytest.raises(SystemExit) as exc:
        designer.main(["--version"])
    assert exc.value.code == 0
    assert version("mnt.designer") in capsys.readouterr().out
    calls = []
    monkeypatch.setattr(designer, "start_server", lambda **kwargs: calls.append(kwargs))
    designer.main(["--host", "127.0.0.1", "--port", "5053", "--no-browser"])
    assert calls == [{"host": "127.0.0.1", "port": 5053, "open_browser": False}]


@pytest.mark.parametrize("host,url_host", [("127.0.0.1", "127.0.0.1"), ("localhost", "localhost"), ("::1", "[::1]")])
def test_cli_browser_url_preserves_bind_host(monkeypatch, capsys, host, url_host):
    opened = []
    calls = []
    monkeypatch.setattr(designer.webbrowser, "open", opened.append)
    monkeypatch.setattr(designer.app, "run", lambda **kwargs: calls.append(kwargs))
    designer.main(["--host", host, "--port", "5053"])
    assert opened == [f"http://{url_host}:5053"]
    assert opened[0] in capsys.readouterr().out
    assert calls == [{"debug": False, "host": host, "port": 5053}]
