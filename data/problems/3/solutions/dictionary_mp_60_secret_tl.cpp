#include <cstring>
#include <cstdio>
#include <vector>
using namespace std;

const int N = (int) 1e6 + 1;
const int A = 26;

struct state {
	int len, link, next_terminal, go[A];
	bool is_terminal;
	int& operator[](char c) {
		return go[c - 'a'];
	}
	state() {
		link = next_terminal = -1;
		is_terminal = len = 0;
		memset(go, -1, sizeof(go));
	}
} states[N];

int total = 0, n, m, u, v, p[N], curtime = 0, depth[N], intime[N], outtime[N], q[N];
char tmp[N];
vector<int> adj[N];

void add(char * tmp) {
	int n = strlen(tmp), j = 0;
	for (int i = 0; i < n; j = states[j][tmp[i++]])
		if (states[j][tmp[i]] == -1) {
			states[j][tmp[i]] = ++total;
			states[total].len = states[j].len + 1;
		}
		states[j].is_terminal = true;
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

void build_automaton() {
	int qh = 0, qe = 0;
	for (int i = 0; i < A; ++i)
		if (states[0].go[i] != -1) {
			states[states[0].go[i]].link = 0;
			q[qe++] = states[0].go[i];
		} else states[0].go[i] = 0;
		while (qh < qe) {
			int v = q[qh++], link = states[v].link;
			states[v].next_terminal = states[link].next_terminal;
			if (states[link].is_terminal) states[v].next_terminal = link;
			for (int i = 0; i < A; ++i)
				if (states[v].go[i] != -1) {
					states[states[v].go[i]].link = states[link].go[i];
					q[qe++] = states[v].go[i];
				} else states[v].go[i] = states[link].go[i];
		}
}

int main() {
	scanf("%d", &n);
	for (int i = 0; i < n; ++i) {
		scanf("%s", tmp);
		add(tmp);
	}
	build_automaton();
	scanf("%s", tmp), n = strlen(tmp);
	memset(p, -1, sizeof(p));
	for (int i = 0, k = 0, j = 0; i < n; ++i) {
		k = j = states[j][tmp[i]];
		while (k != -1) {
			if (states[k].is_terminal) set_parent(i - states[k].len + 1, i + 1);
			k = states[k].link;
		}
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