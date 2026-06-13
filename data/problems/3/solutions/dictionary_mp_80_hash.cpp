#include <cstring>
#include <iostream>
#include <cstdio>
#include <vector>
#include <set>
using namespace std;

const int N = (int) 1e6 + 1;
const long long P = 17239;

int total = 0, n, m, u, v, p[N], curtime = 0, depth[N], intime[N], outtime[N], q[N];
long long h[N], ppow[N];
char tmp[N];
vector<int> adj[N];
set<long long> used, terminal;

void add(char * tmp) {
	int n = strlen(tmp);
	long long h = 0;
	used.insert(0);
	for (int i = 0; i < n; ++i) {
		h = h * P + tmp[i];
		used.insert(h);
	}
	terminal.insert(h);
}

void set_parent(int u, int v) {
	p[u] = v;
	adj[v].push_back(u);
}

void dfs(int v) {
	intime[v] = ++curtime;
	for (int i = 0; i < (int) adj[v].size(); ++i) {
		depth[adj[v][i]] = depth[v] + 1;
		dfs(adj[v][i]);
	}
	outtime[v] = ++curtime;
}

bool is_parent(int u, int v) {
	return (intime[u] <= intime[v]) && (outtime[v] <= outtime[u]);
}

int get_path(int u, int v) {
	return is_parent(v, u) ? depth[u] - depth[v] : -1;
}

int main() {
	scanf("%d", &n);
	for (int i = 0; i < n; ++i) {
		scanf("%s", tmp);
		add(tmp);
	}
	scanf("%s", tmp), n = strlen(tmp);
	memset(p, -1, sizeof(p));
	h[0] = 0, ppow[0] = 1;
	for (int i = 0; i < n; ++i)
		h[i + 1] = h[i] * P + tmp[i], ppow[i + 1] = ppow[i] * P;
	for (int i = 0; i < n; ++i) {
		int l = 0, r = n - i;
		while (l < r) {
			int q = (l + r + 1) / 2;
			if (used.count(h[i + q] - h[i] * ppow[q]))
				l = q;
			else
				r = q - 1;
		}
		if ((l != 0) && (terminal.count(h[i + l] - h[i] * ppow[l]))) set_parent(i, i + l);
	}
	for (int i = n; i >= 0; --i)
		if (p[i] == -1) dfs(i);
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		scanf("%d%d", &u, &v), --u;
		printf("%d\n", get_path(u, v));
	}
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		int sum = 0, t, a, b, c, d, e, l, r;
		scanf("%d %d %d %d %d %d %d %d", &t, &a, &b, &c, &d, &e, &l, &r);
		for (int j = 0; j < t; ++j) {
			int ans = get_path(min(l % n, r % n), max(l % n, r % n) + 1);
			if (ans != -1) sum = (sum + ans) % e;
			l = (a * l + b) % e, r = (c * r + d + ans) % e;
		}
		printf("%d\n", sum);
	}
	return 0;
}