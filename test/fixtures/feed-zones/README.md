A journal of its own, for B42's zone arithmetic.

The `feed/` fixture beside this one is a *visibility* fixture: `test/search.test.ts`
counts its documents exactly and reasons in a comment about which rows each
trip contributes. Adding two days to it to test a clock made that comment
wrong and broke two assertions that have nothing to do with time — so the
zoned days live here instead, where nothing counts them.
