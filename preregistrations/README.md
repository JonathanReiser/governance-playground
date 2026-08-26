# preregistrations/

Public promises and the results that answer them.

A `*.registration.json` file says what a run *will* be — scenario, cycle count,
agent model, the hash of every prompt's doctrine half and every decision schema —
and binds it to a NIST beacon pulse identified only by a future timestamp. Commit
the registration **before** drawing. That is what makes it a promise rather than
a preference: at commit time the pulse does not exist, so nobody, including
whoever registered it, can know which parameters would turn out favourable.

A `*.result.json` file is the answer, hash-chained to both the registration and
the pulse that eventually appeared.

**A registration that never gets a result is supposed to stay here.** Deleting one
because the run came back inconvenient is the exact behaviour this directory exists
to make visible — `prereg list` flags it as `UNPUBLISHED` and `prereg verify`
reports the absence as the finding. Leave it.

The one registration currently here (`67bd00e6…`, middle-east-2026, 2 cycles) is a
real end-to-end exercise of the mechanism against live NIST pulse #1916207, kept as
a worked example rather than as research output.
