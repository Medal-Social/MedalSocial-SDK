---
"@medalsocial/booking": minor
---

Several guest grown-ups are told apart. Once two or more seats share the generic `people.adult` word («Voksen»), the service step's tabs and «who cuts whom» call them «Person 1», «Person 2», … from the new `wizard.party.adult` label (`Person {n}` in both built-in packs, numbered among those grown-ups only). A lone grown-up, «Meg selv» and the children keep their names.

A site that sets its own `people.adult` keeps that word on every seat until it opts in by setting `wizard.party.adult` too. This works through `mergeLabels` and through the components' `labels` props. The key is optional, so an older pack still type-checks. Also adds a wizard test for the `service.bar` class slot on the multi-select step's sticky bar.
