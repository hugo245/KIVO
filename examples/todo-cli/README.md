# todo — a KIVO command line app

A project with a `kivo.toml`, several modules, a class, a `type` used to validate stored data, and tests.

```sh
cd examples/todo-cli
kivo run add "Buy milk"
kivo run add "Learn KIVO"
kivo run done 1
kivo run list
kivo test
kivo build          # creates dist/todo.js — run it with: node dist/todo.js list
```
