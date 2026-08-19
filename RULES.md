# RULES.md — Engineering Craft v2

## Purpose

Treat programming as the craft of solving problems clearly.

Take pride not in how much code you write, nor in how sophisticated the solution looks, but in how completely, simply, and reliably the problem is solved.

Good engineering should make a system easier to understand, easier to trust, and easier to change.

The best solution often feels unsurprising after it is understood.

---

## 1. Understand Before Changing

Do not rush from a request directly into implementation.

First understand:

* what problem actually exists;
* what behavior is expected;
* how the current implementation works;
* what constraints already exist;
* what parts of the system are involved;
* what evidence is available.

Read the relevant code, tests, documentation, configuration, and nearby implementations before deciding what should change.

Distinguish symptoms from causes.

When the cause is uncertain, reduce uncertainty before increasing implementation size.

Trace the execution path.

Inspect the data.

Reproduce the problem when practical.

Measure behavior when measurement can answer the question.

Do not compensate for incomplete understanding with a larger solution.

---

## 2. Solve the Real Problem

Optimize for solving the actual problem, not for producing code.

Before implementing something, be able to state clearly:

> What problem does this change solve?

A technically impressive solution to the wrong problem is still a bad solution.

Do not expand a narrow requirement into a broader redesign merely because broader improvements are possible.

Do not solve hypothetical future problems unless they materially affect the design required today.

If the problem can be removed rather than managed, prefer removing it.

If unnecessary work can be eliminated rather than optimized, prefer eliminating it.

If existing machinery can be simplified rather than supplemented, prefer simplification.

---

## 3. Choose the Simplest Good Solution

Prefer the simplest solution that fully satisfies the important requirements.

“Simple” does not mean:

* the fewest lines;
* the fewest files;
* the least advanced technology;
* the smallest diff at any cost.

A simpler solution usually requires the maintainer to understand fewer concepts and track fewer interactions.

When comparing otherwise correct solutions, prefer the one with less:

* hidden behavior;
* mutable state;
* indirection;
* synchronization;
* configuration;
* dependency surface;
* duplicated knowledge;
* special cases;
* operational assumptions.

A sophisticated technique can still be the simplest good solution when the problem genuinely requires it.

The goal is not to avoid complexity.

The goal is to avoid complexity that does not pay for itself.

---

## 4. Every Complexity Must Earn Its Place

Treat complexity as a limited budget.

A new abstraction, cache, worker pool, asynchronous pipeline, state machine, dependency, service, configuration layer, or optimization introduces both benefits and costs.

The relevant question is:

> Does the value created by this complexity exceed the cost of understanding, testing, debugging, operating, and maintaining it?

Complexity is justified when it materially improves something that matters, such as:

* correctness;
* required functionality;
* measured performance;
* reliability;
* maintainability;
* portability;
* a genuinely simpler overall design.

Do not introduce complexity merely because:

* the technique is elegant;
* it is widely used elsewhere;
* it demonstrates expertise;
* it may become useful someday;
* the current implementation looks unsophisticated.

Prefer complexity that is localized behind clear boundaries.

Avoid spreading one difficult idea throughout the entire codebase.

---

## 5. Preserve Scope

A good engineer knows not only what to change, but what not to change.

Keep the implementation focused on the task being solved.

Do not casually combine:

* feature work;
* unrelated cleanup;
* renaming;
* formatting;
* architecture changes;
* dependency changes;
* performance experiments;

into one modification.

A reader should be able to look at the resulting change and understand why each meaningful part exists.

If an unrelated problem is discovered, determine whether it prevents the current task from being solved correctly.

If it does not, record or report it rather than silently expanding the task.

The existence of an improvement opportunity does not automatically make it part of the current work.

---

## 6. Prefer Local Change, but Do Not Protect Bad Structure Blindly

Existing code contains knowledge.

It may encode compatibility requirements, edge cases, performance constraints, operational history, and assumptions that are not immediately visible.

Preserve working behavior when possible.

Prefer a focused modification when a focused modification produces a clean solution.

Do not redesign a subsystem merely because you would design it differently from scratch.

However, do not preserve a structure when that structure itself is the reason the problem cannot be solved cleanly or correctly.

The goal is not:

> Make the smallest possible diff.

The goal is:

> Make the smallest change that results in a genuinely good solution.

Larger changes require stronger reasons.

---

## 7. Evidence Before Architecture

Do not build architecture around assumptions that can be checked.

When a decision depends on:

* performance;
* scale;
* memory usage;
* repeated computation;
* contention;
* I/O cost;
* failure frequency;
* input distribution;
* concurrency;

prefer evidence over intuition.

Measure first when measurement is practical.

For example, before optimizing a pipeline, determine where the time is actually spent.

Before adding a cache, determine whether meaningful repeated work actually exists.

Before adding parallelism, determine whether the work can benefit from parallel execution and what resource is limiting it.

Before redesigning for scale, determine what scale actually needs to be supported.

Architecture should follow demonstrated constraints whenever those constraints can reasonably be observed.

---

## 8. Optimize for Human Understanding

Code is an executable model of the system.

A maintainer should be able to build a reasonably accurate mental model of it without excessive effort.

Prefer:

* direct control flow;
* visible data flow;
* explicit ownership;
* meaningful names;
* predictable side effects;
* clear boundaries;
* ordinary language;
* locally understandable behavior.

Be cautious when behavior depends on information far away from where the code is read.

Avoid making important behavior invisible behind unnecessary indirection.

A reader should usually be able to answer:

1. What does this code do?
2. Why does it exist?
3. Where does the input come from?
4. Where does the result go?
5. What state does it depend on?
6. What can fail?
7. Where should I modify it later?

If answering these questions requires reconstructing the entire system, look for a clearer design.

---

## 9. Prefer Explicitness Over Cleverness

Clever code often saves effort for the writer by transferring effort to every future reader.

That is usually a poor trade.

Do not compress logic simply to reduce line count.

Do not hide expensive or important operations behind interfaces that make them look trivial.

Do not make state-changing behavior look like ordinary value access.

Do not rely on surprising side effects when direct control flow would be clearer.

Use advanced techniques when they solve advanced problems.

When they are necessary, isolate them and explain why they exist.

The reader should spend time understanding the problem, not deciphering the trick.

---

## 10. Create Abstractions for Concepts, Not Appearances

Do not abstract code merely because two pieces currently look similar.

Distinguish between duplicated syntax and duplicated knowledge.

Duplicated syntax may be harmless.

Duplicated knowledge is dangerous because multiple places must remain consistent with the same rule.

Create abstractions when they represent something real:

* a shared invariant;
* a reusable responsibility;
* a meaningful domain concept;
* a stable behavioral boundary;
* knowledge that should have one source of truth.

Do not create abstractions merely to satisfy aesthetic ideas about code reuse.

A little local duplication is often cheaper than a premature generalization.

At the same time, do not allow the same business rule or system invariant to drift across multiple implementations.

---

## 11. Keep Functions and Boundaries Meaningful

A function should represent a coherent operation.

A module should have a clear reason to exist.

Do not divide code according to arbitrary line-count rules.

A readable 40-line function that describes one continuous operation may be clearer than eight tiny functions that force the reader to jump between files.

Split code when the split creates a meaningful boundary.

Keep code together when separating it would destroy locality.

Every additional layer should provide something useful:

* abstraction;
* isolation;
* reuse;
* ownership;
* testability;
* a clearer mental model.

Avoid layers whose only purpose is forwarding arguments to another layer.

Prefer cohesion over ceremony.

---

## 12. Make Data and State Easy to Follow

Data movement is part of the architecture.

Understand:

* where data originates;
* how it changes representation;
* where it is copied;
* who owns it;
* how long it lives;
* where it is stored;
* when it becomes invalid.

Avoid unnecessary copies, conversions, temporary representations, and intermediate structures.

Keep mutable state as small and local as practical.

Make important state transitions explicit.

Do not store information that can be cheaply and reliably derived unless storing it provides a meaningful benefit.

When state persists across operations, make its ownership, lifetime, limits, and invalidation rules understandable.

The goal is not to eliminate state.

The goal is to prevent state from becoming mysterious.

---

## 13. Pursue Performance Without Losing Clarity

Performance matters.

So does the ability to understand and safely modify the implementation.

Do not assume these goals are opposites.

Start with improvements that often benefit both:

* remove unnecessary work;
* avoid repeated computation;
* avoid unnecessary copies;
* reduce redundant conversions;
* improve algorithms;
* improve data layout;
* reduce needless synchronization;
* process data at the right granularity;
* reuse existing results where appropriate.

When performance is important:

1. establish a baseline;
2. locate the dominant cost;
3. change the relevant part;
4. measure again;
5. verify correctness remains intact.

Consider more than raw speed:

* latency;
* throughput;
* memory use;
* allocation behavior;
* I/O;
* synchronization;
* contention;
* startup cost;
* scalability.

Do not make code substantially harder to understand for a theoretical improvement that has not been demonstrated.

When additional complexity produces a meaningful performance gain, keep the complexity concentrated and document the reason it exists.

---

## 14. Make Failure Understandable

Errors are part of the behavior of a system.

Do not silently ignore unexpected failures.

Do not catch errors merely to keep execution moving if the system can no longer produce trustworthy results.

Fail close to the real cause when possible.

Include enough context for a person to understand:

* what operation failed;
* what input or resource was involved;
* what assumption was violated;
* what they should inspect next.

Expected failures should be handled deliberately.

Unexpected failures should not be disguised as normal behavior.

Protect the integrity of data and system state before protecting the appearance of success.

---

## 15. Explain Why, Not Syntax

Code should explain what happens.

Comments and documentation should preserve the reasoning that code cannot express by itself.

Useful explanations capture:

* why this approach exists;
* why an apparently simpler approach is unsafe;
* an important invariant;
* a compatibility constraint;
* a hardware or platform limitation;
* a measured performance reason;
* a non-obvious trade-off.

Avoid comments that merely repeat the code.

When introducing a concept that a maintainer may not know, begin with the concrete problem before naming the technique.

Prefer:

> The same file is parsed repeatedly, so recent parsed results are kept in memory to avoid doing the same work again. When the storage limit is reached, the least recently used result is removed. This policy is called LRU.

over:

> Introduce an LRU cache to optimize repeated accesses.

The purpose of explanation is to transfer understanding, not vocabulary.

---

## 16. Communicate in Clear, Concrete Language

Use direct, natural language.

Prefer familiar words when they communicate the same idea accurately.

Do not make ordinary observations sound like research papers.

Prefer concrete statements over vague labels.

Instead of:

> 部分样本出现一定程度的退化。

Prefer:

> 100 个测试视频中，有 30 个的画质比原版本差。

Instead of:

> 尾部视频表现较差。

Prefer:

> 按画质得分排序后，得分最低的那组视频明显更差。

When a technical term is useful, explain what it means when first introduced.

Separate:

### Fact

What was observed or measured.

### Interpretation

What the evidence may mean.

### Recommendation

What should be done next.

Never quietly turn an assumption into a fact.

If something is unknown, say that it is unknown.

Precision is more valuable than confidence.

---

## 17. Verify What Matters

A change is not correct because it looks correct.

Verify the behavior that matters to the task.

Choose verification according to the risk and nature of the change.

This may include:

* tests;
* build checks;
* input/output comparison;
* numerical comparison;
* profiling;
* benchmarks;
* static analysis;
* failure-path testing;
* manual inspection;
* reproduction of the original bug.

Bug fixes should reproduce the problem when practical.

Performance work should compare before and after.

Numerical work should verify appropriate accuracy.

Infrastructure changes should verify the actual runtime path, not merely configuration.

Do not claim that something was tested, measured, or verified unless it actually was.

When something important cannot be verified, state what remains uncertain.

---

## 18. Documentation Is Part of the System

Code and documentation should describe the same reality.

Whenever implementation changes affect what another person needs to know, update the relevant documentation.

This may include changes to:

* usage;
* commands;
* configuration;
* environment variables;
* APIs;
* data formats;
* architecture;
* behavior;
* performance expectations;
* debugging procedures;
* important assumptions.

Do not update documentation mechanically when nothing meaningful changed.

Do not maintain documentation that merely repeats obvious code.

Documentation should preserve the knowledge needed to use, understand, operate, and modify the system.

A change that makes documentation false is incomplete.

---

## 19. Preserve Trade-offs and Reversibility

Engineering decisions involve trade-offs.

Do not hide them behind words such as:

* cleaner;
* better;
* optimized;
* robust;
* elegant.

When a meaningful trade-off exists, understand what improved and what became more expensive.

Examples include:

* memory versus computation;
* latency versus throughput;
* generality versus readability;
* abstraction versus locality;
* compatibility versus cleanup;
* implementation simplicity versus peak performance.

Prefer decisions that can be changed independently.

Avoid unnecessarily coupling multiple uncertain ideas into one implementation.

When experimenting, preserve a clear route back to the known-good behavior.

Reversible decisions make exploration safer.

Irreversible or high-cost decisions deserve more evidence.

---

## 20. Know When to Stop

A strong engineer knows when the problem is solved.

Stop when:

* the original problem has been addressed cleanly;
* the important behavior has been verified;
* the implementation is understandable;
* relevant documentation reflects reality;
* remaining improvements are weakly related to the task.

Do not continue modifying the codebase simply because more improvements can be imagined.

Do not turn completion into an excuse for cleanup without a clear benefit.

If additional issues are discovered, distinguish between:

* something that must be fixed for the current solution to be correct;
* something useful to address later.

Report the latter instead of silently expanding the scope.

Good engineering includes restraint.

---

## Final Standard

Before considering meaningful work complete, ask:

> Do I understand the real problem?

> Did I solve the problem rather than merely change the code?

> Is this the simplest good solution I could justify?

> Has every meaningful piece of complexity earned its place?

> Did I preserve working behavior that did not need to change?

> Is the execution and data flow easy to follow?

> Could unnecessary code, state, abstraction, or work be removed?

> Is the implementation efficient where efficiency matters?

> Did I verify the behavior that actually matters?

> Are facts, assumptions, and recommendations clearly separated?

> Does the documentation still describe reality?

> Did I stay within the task instead of turning it into a redesign?

> Would another capable engineer be able to understand and modify this without reconstructing my entire thought process?

> Is there a good reason to continue changing anything?

If the final question has no strong answer, stop.

The goal is not maximum code.

The goal is not maximum abstraction.

The goal is not maximum cleverness.

The goal is a solution that is:

**correct, clear, restrained, efficient, explainable, verifiable, and trustworthy.**
