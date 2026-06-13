#include <cstdio>
#include <algorithm>
#include <cstring>
using namespace std;

const int N = (int) 1e6 + 1;
const int A = 26;
const int inf = (int) 1e9;
const int P = 17239;
int res, n, m, l, r, len[N], p[N], go[N][A], total = 0;
char s[N], tmp[N];
bool terminal[N];

void add(char * s) {
	int n = strlen(s), j = 0;
	for (int i = 0; i < n; j = go[j][s[i++] - 'a'])
		if (go[j][s[i] - 'a'] == -1) go[j][s[i] - 'a'] = ++total;
	terminal[j] = true;
}

int get_path(int l, int r) {
	int res = 0;
	while ((l != -1) && (l < r)) l = p[l], ++res;
	if (l != r) res = -1;
	return res;
}

int main() {
	memset(go, -1, sizeof(go));
	scanf("%d", &n);
	for (int i = 0; i < n; ++i) {
		scanf("%s", tmp);
		add(tmp);
	}
	scanf("%s", s);
	m = strlen(s);
	for (int i = 0; i < m; ++i) {
		p[i] = -1;
		int j = 0, k = i;
		while ((k < m) && (go[j][s[k] - 'a'] != -1)) j = go[j][s[k++] - 'a'];
		if (terminal[j]) p[i] = k;
	}
	n = m;
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		scanf("%d%d", &l, &r), --l;
		printf("%d\n", get_path(l, r));
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