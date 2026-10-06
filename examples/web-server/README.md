# Web server examples

```sh
kivo run server.kivo        # http://localhost:3000 and /hello/<name>
PORT=3001 kivo run api.kivo # JSON API on http://localhost:3001
```

Try the API:

```sh
curl localhost:3001/api/users
curl localhost:3001/api/users/1
curl -X POST localhost:3001/api/users -H "content-type: application/json" -d '{"username": "Sam"}'
curl -X POST localhost:3001/api/users -H "content-type: application/json" -d '{"coins": 5}'   # 400: username missing
curl localhost:3001/static/
```
