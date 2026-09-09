from quantum_arena.validation import RUNTIME_DISCIPLINES, run_all


def test_every_machine_checkable_item_passes():
    report = run_all()
    failed = [c["item"] for c in report["checks"] if not c["passed"]]
    assert not failed, f"validation items failed: {failed}"
    assert report["all_passed"]


def test_the_report_covers_items_one_through_seven():
    assert [c["item"] for c in run_all()["checks"]] == [1, 2, 3, 4, 5, 6, 7]


def test_items_eight_to_ten_are_declared_not_machine_checkable():
    """They are runtime disciplines about record-keeping, not properties of the
    code. Silently omitting them would read as 'all ten validated'."""
    assert set(RUNTIME_DISCIPLINES) == {8, 9, 10}


def test_equilibrium_report_carries_its_scope_warning():
    """An equilibrium within four options must never be reported unqualified."""
    item = next(c for c in run_all()["checks"] if c["item"] == 7)
    assert "SU(2)" in item["scope_warning"]
    assert item["tolerance"] == 1e-9
