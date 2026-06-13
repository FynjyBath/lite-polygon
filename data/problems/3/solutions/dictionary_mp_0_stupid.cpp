#include <cstdio>
#include <cstring>

const int N = (int) 1e6 + 1;
const int inf = (int) 1e9;
int n, m, l, r, len[N], ans[N];
char s[N], tmp[N];
char *wrd[N];

bool match(char * a, char * b, int l) {
	for (int i = 0; i < l; ++i)
		if (a[i] != b[i]) return false;
	return true;
}

int main() {
	scanf("%d", &n);
	for (int i = 0; i < n; ++i) {
		scanf("%s", tmp);
		len[i] = strlen(tmp);
		wrd[i] = new char[len[i] + 1];
		strcpy(wrd[i], tmp);
	}
	scanf("%s", s);
	scanf("%d", &m);
	for (int i = 0; i < m; ++i) {
		scanf("%d%d", &l, &r), --l, --r;
		for (int i = l; i <= r + 1; ++i)
			ans[i] = inf;
		ans[l] = 0;
		for (int i = l; i <= r; ++i)
			for (int j = 0; j < n; ++j)
				if ((i + len[j] <= r + 1) && (ans[i + len[j]] > ans[i] + 1) && match(s + i, wrd[j], len[j]))
					ans[i + len[j]] = ans[i] + 1;
		if (ans[r + 1] == inf) ans[r + 1] = -1;
		printf("%d\n", ans[r + 1]);
	}
}