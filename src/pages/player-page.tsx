// @ts-nocheck
import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUpDown, ChevronRight } from "lucide-react";
import { Movie, ApiSite } from "@/types";

import { API_SITES } from "@/config/apiSites";
import { getSelectedApiSites } from "@/utils/apiSite";
import { Card, CardContent } from "@/components/ui/card";
import { ListVideo } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "lucide-react";
import { fetchWithProxy } from "@/utils/proxy";
// --- Interfaces ---
interface Episode {
  number: string;
  url: string;
}

interface DetailApiResponse {
  code: number;
  msg: string;
  list: Movie[];
}

interface PlayHistoryItem {
  vodId: string;
  title: string;
  pic: string;
  episode: string;
  timestamp: number;
  source: string;
  sortOrder: "asc" | "desc";
  skipStart: number;
  skipEnd: number;
}

// --- Main Player Page Component ---
function PlayerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [movieDetails, setMovieDetails] = useState<Movie | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [currentSource, setCurrentSource] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [skipStart, setSkipStart] = useState<number>(0);
  const [skipEnd, setSkipEnd] = useState<number>(0);
  const artRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Artplayer | null>(null);

  const [availableSources, setAvailableSources] = useState<{ key: string; name: string }[]>([]);

  const vodId = searchParams.get("vodId");
  const initialEpNum = searchParams.get("epNum");
  const sourceKey = searchParams.get("source");

  // --- Hooks called unconditionally at the top ---
  const episodes = useMemo(() => {
    if (!movieDetails?.vod_play_url) return [];
    try {
      let playUrlData = movieDetails.vod_play_url;
      // 检查是否包含 $$$，如果包含则取最后一个分段
      if (playUrlData.includes("$$$")) {
        const parts = playUrlData.split("$$$");
        playUrlData = parts[parts.length - 1];
      }

      // 使用 # 分割剧集信息
      return playUrlData
        .split("#")
        .map((part: string) => {
          const [number, url] = part.split("$");
          if (number && url && url.startsWith("http")) {
            return { number: number.trim(), url: url.trim() };
          }
          return null;
        })
        .filter((ep: Episode | null): ep is Episode => ep !== null);
    } catch (error) {
      console.error("Error parsing episodes string:", error);
      return [];
    }
  }, [movieDetails]);

  const sortedEpisodes = useMemo(() => {
    // 如果是正序，直接返回原始顺序的副本
    if (sortOrder === "asc") {
      return [...episodes];
    }
    // 如果是倒序，返回反转后的副本
    return [...episodes].reverse();
  }, [episodes, sortOrder]);

  // --- Effects ---
  useEffect(() => {
    if (!vodId) {
      setError("无效的视频 ID");
      setIsLoading(false);
      return;
    }
    const fetchDetails = async () => {
      setIsLoading(true);
      setError(null);
      setMovieDetails(null);
      setCurrentSource(null);
      try {
        if (!sourceKey) {
          throw new Error("缺少视频源参数 (source)");
        }

        // 加载默认和自定义站点
        const defaultSites = API_SITES;
        const customSites: ApiSite[] = JSON.parse(localStorage.getItem("customApiSites") || "[]");
        const allSites = [...defaultSites, ...customSites];

        // 查找对应的站点 API
        const foundSite = allSites.find((site) => site.key === sourceKey);

        if (!foundSite) {
          throw new Error(`未找到源: ${sourceKey}`);
        }

        const apiBase = foundSite.api;

        // 使用 ac=detail 获取详情
        const targetUrl = `${apiBase}/api.php/provide/vod/?ac=detail&ids=${vodId}`;
        const response = await fetchWithProxy(targetUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data: DetailApiResponse = await response.json();
        if (data.code === 1 && data.list && data.list.length > 0) {
          setMovieDetails(data.list[0]);
        } else {
          throw new Error(data.msg || "无法获取视频详情");
        }
      } catch (e) {
        console.error("Failed to fetch movie details:", e);
        setError(e instanceof Error ? e.message : "加载详情失败");
      } finally {
        setIsLoading(false);
      }
    };
    fetchDetails();
  }, [vodId, sourceKey]);

  useEffect(() => {
    if (episodes.length > 0) {
      // 如果有初始集数，尝试使用它
      if (initialEpNum) {
        const decodedEpNum = decodeURIComponent(initialEpNum);
        const initialEpisode = episodes.find((ep: Episode) => ep.number === decodedEpNum);
        if (initialEpisode) {
          setCurrentSource(initialEpisode.url);
          return;
        }
      }

      // 尝试从历史记录中获取上次播放的集数
      if (vodId && sourceKey) {
        try {
          const raw = localStorage.getItem("playHistory");
          if (raw) {
            const history: PlayHistoryItem[] = JSON.parse(raw);
            const currentItem = history.find((item) => item.vodId === vodId && item.source === sourceKey);
            if (currentItem) {
              const historyEpisode = episodes.find((ep: Episode) => ep.number === currentItem.episode);
              if (historyEpisode) {
                setCurrentSource(historyEpisode.url);
                setSearchParams(
                  {
                    vodId: vodId,
                    epNum: encodeURIComponent(historyEpisode.number),
                    source: sourceKey,
                  },
                  { replace: true }
                );
                return;
              }
            }
          }
        } catch (error) {
          console.error("Error loading play history:", error);
        }
      }

      // 如果以上都没有，默认播放第一集
      setCurrentSource(episodes[0].url);
      setSearchParams(
        {
          vodId: vodId!,
          epNum: encodeURIComponent(episodes[0].number),
          source: sourceKey || "",
        },
        { replace: true }
      );
    } else {
      setCurrentSource(null);
    }
  }, [episodes, initialEpNum, vodId, sourceKey, setSearchParams]);

  // 从本地存储加载播放记录和设置
  useEffect(() => {
    if (vodId && sourceKey) {
      try {
        const raw = localStorage.getItem("playHistory");
        if (raw) {
          const history: PlayHistoryItem[] = JSON.parse(raw);
          const currentItem = history.find((item) => item.vodId === vodId && item.source === sourceKey);
          if (currentItem) {
            setSortOrder(currentItem.sortOrder);
            setSkipStart(currentItem.skipStart);
            setSkipEnd(currentItem.skipEnd);
            if (initialEpNum === null) {
              setSearchParams(
                {
                  vodId: vodId,
                  epNum: encodeURIComponent(currentItem.episode),
                  source: sourceKey,
                },
                { replace: true }
              );
            }
          }
        }
      } catch (error) {
        console.error("Error loading play history:", error);
      }
    }
  }, [vodId, sourceKey, initialEpNum, setSearchParams]);

  // 写入播放记录
  const writePlayHistory = (episode: Episode) => {
    if (!movieDetails) return;
    const item: PlayHistoryItem = {
      vodId: String(movieDetails.vod_id),
      title: movieDetails.vod_name,
      pic: movieDetails.vod_pic,
      episode: String(episode.number),
      timestamp: Date.now(),
      source: sourceKey || "",
      sortOrder: sortOrder,
      skipStart: skipStart,
      skipEnd: skipEnd,
    };
    try {
      const raw = localStorage.getItem("playHistory");
      let arr: PlayHistoryItem[] = raw ? JSON.parse(raw) : [];
      arr = arr.filter((i) => i.vodId !== item.vodId || i.source !== item.source);
      arr.unshift(item);
      if (arr.length > 20) arr = arr.slice(0, 20);
      localStorage.setItem("playHistory", JSON.stringify(arr));
    } catch {
      // ignore
    }
  };

  // 更新跳过设置
  const updateSkipSettings = (newSkipStart: number, newSkipEnd: number) => {
    setSkipStart(newSkipStart);
    setSkipEnd(newSkipEnd);
    if (movieDetails) {
      try {
        const raw = localStorage.getItem("playHistory");
        if (raw) {
          const history: PlayHistoryItem[] = JSON.parse(raw);
          const index = history.findIndex((item) => item.vodId === String(movieDetails.vod_id) && item.source === sourceKey);
          if (index !== -1) {
            history[index].skipStart = newSkipStart;
            history[index].skipEnd = newSkipEnd;
            localStorage.setItem("playHistory", JSON.stringify(history));
          }
        }
      } catch (error) {
        console.error("Error updating skip settings:", error);
      }
    }
  };

  useEffect(() => {
    if (movieDetails && currentSource) {
      const ep = episodes.find((ep: Episode) => ep.url === currentSource);
      if (ep) writePlayHistory(ep);
    }
  }, [currentSource, movieDetails, episodes]);

  useEffect(() => {
    if (currentSource && artRef.current) {
      if (playerRef.current) {
        playerRef.current.destroy();
      }

      const currentEpisodeNumber = sortedEpisodes.find((ep) => ep.url === currentSource)?.number;
      const playerId = `morphotv-${vodId}-${sourceKey || "default"}-${currentEpisodeNumber || "1"}`;

      const art = new Artplayer({
        container: artRef.current,
        url: currentSource,
        setting: true,
        autoplay: true,
        pip: true,
        fullscreen: true,
        fullscreenWeb: true,
        miniProgressBar: true,
        hotkey: true,
        playbackRate: true,
        lock: true,
        fastForward: true,
        id: playerId,
        autoPlayback: true,
        autoOrientation: true,
        theme: "#23ade5",
        settings: [
          {
            width: 200,
            html: "跳过设置",
            tooltip: "设置跳过时间",
            selector: [
              {
                html: "片头跳过",
                tooltip: `${skipStart}秒`,
                selector: [
                  {
                    default: skipStart === 0,
                    html: "0秒",
                    value: 0,
                  },
                  {
                    default: skipStart === 30,
                    html: "30秒",
                    value: 30,
                  },
                  {
                    default: skipStart === 60,
                    html: "1分钟",
                    value: 60,
                  },
                  {
                    default: skipStart === 90,
                    html: "1分30秒",
                    value: 90,
                  },
                  {
                    default: skipStart === 120,
                    html: "2分钟",
                    value: 120,
                  },
                  {
                    default: skipStart === 150,
                    html: "2分30秒",
                    value: 150,
                  },
                  {
                    default: skipStart === 180,
                    html: "3分钟",
                    value: 180,
                  },
                  {
                    default: skipStart === 210,
                    html: "3分30秒",
                    value: 210,
                  },
                  {
                    default: skipStart === 240,
                    html: "4分钟",
                    value: 240,
                  },
                  {
                    default: skipStart === 270,
                    html: "4分30秒",
                    value: 270,
                  },
                  {
                    default: skipStart === 300,
                    html: "5分钟",
                    value: 300,
                  },
                ],
                onSelect: function (item) {
                  updateSkipSettings(item.value, skipEnd);
                  return `${item.value}秒`;
                },
              },
              {
                html: "片尾跳过",
                tooltip: `${skipEnd}秒`,
                selector: [
                  {
                    default: skipEnd === 0,
                    html: "0秒",
                    value: 0,
                  },
                  {
                    default: skipEnd === 30,
                    html: "30秒",
                    value: 30,
                  },
                  {
                    default: skipEnd === 60,
                    html: "1分钟",
                    value: 60,
                  },
                  {
                    default: skipEnd === 90,
                    html: "1分30秒",
                    value: 90,
                  },
                  {
                    default: skipEnd === 120,
                    html: "2分钟",
                    value: 120,
                  },
                  {
                    default: skipEnd === 150,
                    html: "2分30秒",
                    value: 150,
                  },
                  {
                    default: skipEnd === 180,
                    html: "3分钟",
                    value: 180,
                  },
                  {
                    default: skipEnd === 210,
                    html: "3分30秒",
                    value: 210,
                  },
                  {
                    default: skipEnd === 240,
                    html: "4分钟",
                    value: 240,
                  },
                  {
                    default: skipEnd === 270,
                    html: "4分30秒",
                    value: 270,
                  },
                  {
                    default: skipEnd === 300,
                    html: "5分钟",
                    value: 300,
                  },
                ],
                onSelect: function (item) {
                  updateSkipSettings(skipStart, item.value);
                  return `${item.value}秒`;
                },
              },
            ],
          },
        ],
        customType: {
          m3u8: function playM3u8(video, url, art) {
            if (Hls.isSupported()) {
              if (art.hls) art.hls.destroy();
              const hls = new Hls();
              const proxyUrl = localStorage.getItem("m3u8ProxySelected");
              const finalUrl = proxyUrl ? `${proxyUrl}${url}` : url;
              hls.loadSource(finalUrl);
              hls.attachMedia(video);
              art.hls = hls;
              art.on("destroy", () => hls.destroy());
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
              const proxyUrl = localStorage.getItem("m3u8ProxySelected");
              const finalUrl = proxyUrl ? `${proxyUrl}${url}` : url;
              video.src = finalUrl;
            } else {
              art.notice.show = "不支持的播放格式: m3u8";
            }
          },
        },
      });

      // 监听视频播放完毕事件
      art.on("video:ended", () => {
        const currentIndex = sortedEpisodes.findIndex((ep) => ep.url === currentSource);
        let nextEpisode: Episode | undefined;

        if (sortOrder === "asc") {
          // 正序播放，下一集索引 +1
          nextEpisode = sortedEpisodes[currentIndex + 1];
        } else {
          // 倒序播放，下一集索引 -1
          nextEpisode = sortedEpisodes[currentIndex - 1];
        }

        if (nextEpisode) {
          // 如果还有下一集，自动播放下一集
          handleEpisodeSelect(nextEpisode);
        } else {
          // 没有下一集，显示播放完毕提示
          art.notice.show = "全部剧集已播放完毕";
        }
      });

      // 监听视频加载完成事件
      art.on("video:loadedmetadata", () => {
        // 设置初始播放位置（跳过片头）
        if (skipStart > 0) {
          art.seek = skipStart;
        }
      });

      // 监听视频播放进度
      art.on("video:timeupdate", () => {
        const duration = art.duration;
        const currentTime = art.currentTime;
        // 如果接近片尾，自动跳过
        if (skipEnd > 0 && duration - currentTime <= skipEnd) {
          art.seek = duration;
        }
      });

      playerRef.current = art;

      return () => {
        if (art) {
          art.destroy();
        }
      };
    }
  }, [currentSource, vodId, sortedEpisodes, sourceKey, skipStart, skipEnd]);

  // --- Event Handlers ---
  const toggleSortOrder = () => {
    setSortOrder((prev) => {
      const newOrder = prev === "asc" ? "desc" : "asc";
      // 更新本地存储中的排序状态
      if (movieDetails) {
        try {
          const raw = localStorage.getItem("playHistory");
          if (raw) {
            const history: PlayHistoryItem[] = JSON.parse(raw);
            const index = history.findIndex((item) => item.vodId === String(movieDetails.vod_id) && item.source === sourceKey);
            if (index !== -1) {
              history[index].sortOrder = newOrder;
              localStorage.setItem("playHistory", JSON.stringify(history));
            }
          }
        } catch (error) {
          console.error("Error updating sort order in history:", error);
        }
      }
      return newOrder;
    });
  };

  const handleEpisodeSelect = (episode: Episode) => {
    setCurrentSource(episode.url);
    setSearchParams({ vodId: vodId!, epNum: encodeURIComponent(episode.number), source: sourceKey || "" }, { replace: true });
    // 切集时也写入历史，带上sourceKey
    if (movieDetails) {
      const item: PlayHistoryItem = {
        vodId: String(movieDetails.vod_id),
        title: movieDetails.vod_name,
        pic: movieDetails.vod_pic,
        episode: String(episode.number),
        timestamp: Date.now(),
        source: sourceKey || "",
        sortOrder: sortOrder,
        skipStart: skipStart,
        skipEnd: skipEnd,
      };
      try {
        const raw = localStorage.getItem("playHistory");
        let arr: PlayHistoryItem[] = raw ? JSON.parse(raw) : [];
        arr = arr.filter((i) => i.vodId !== item.vodId || i.source !== item.source);
        arr.unshift(item);
        if (arr.length > 20) arr = arr.slice(0, 20);
        localStorage.setItem("playHistory", JSON.stringify(arr));
      } catch {
        // ignore
      }
    }
  };

  // 获取所有启用的资源站
  const getAllEnabledSites = useMemo(() => {
    const selectedKeys = getSelectedApiSites();
    const defaultSites = API_SITES.filter((site) => selectedKeys.includes(site.key));
    const customSites = JSON.parse(localStorage.getItem("customApiSites") || "[]") as ApiSite[];
    const selectedCustomSites = customSites.filter((site) => selectedKeys.includes(site.key));
    return [...defaultSites, ...selectedCustomSites];
  }, []);

  // 搜索其他资源站的相同视频
  const searchOtherSources = async () => {
    if (!movieDetails?.vod_name) return;

    const sources: { key: string; name: string }[] = [];

    try {
      await Promise.all(
        getAllEnabledSites.map(async (site) => {
          if (site.key === sourceKey) {
            sources.push({ key: site.key, name: site.name });
            return;
          }

          const targetUrl = `${site.api}/api.php/provide/vod/?ac=videolist&wd=${encodeURIComponent(movieDetails.vod_name)}`;

          try {
            const response = await fetchWithProxy(targetUrl);
            if (!response.ok) return;
            const data = await response.json();

            if (data.code === 1 && data.list) {
              const exactMatch = data.list.find((item: Movie) => item.vod_name === movieDetails.vod_name);

              if (exactMatch) {
                sources.push({ key: site.key, name: site.name });
              }
            }
          } catch (error) {
            console.error(`Error searching in site ${site.name}:`, error);
          }
        })
      );

      setAvailableSources(sources);
    } catch (error) {
      console.error("Error searching other sources:", error);
    }
  };

  // 处理资源站切换
  const handleSourceChange = async (newSourceKey: string) => {
    if (!movieDetails?.vod_name || newSourceKey === sourceKey) return;

    const targetUrl = `${getAllEnabledSites.find((site) => site.key === newSourceKey)?.api}/api.php/provide/vod/?ac=videolist&wd=${encodeURIComponent(movieDetails.vod_name)}`;
    try {
      const response = await fetchWithProxy(targetUrl);
      if (!response.ok) return;
      const data = await response.json();

      if (data.code === 1 && data.list) {
        const matchedVideo = data.list.find((item: Movie) => item.vod_name === movieDetails.vod_name);

        if (matchedVideo) {
          const currentEpNum = sortedEpisodes.find((ep) => ep.url === currentSource)?.number;
          const newVodId = matchedVideo.vod_id;

          // 获取新资源站的剧集列表
          const detailUrl = `${getAllEnabledSites.find((site) => site.key === newSourceKey)?.api}/api.php/provide/vod/?ac=detail&ids=${newVodId}`;
          const detailResponse = await fetchWithProxy(detailUrl);
          const detailData = await detailResponse.json();

          if (detailData.code === 1 && detailData.list && detailData.list.length > 0) {
            const newEpisodes = detailData.list[0].vod_play_url
              .split("#")
              .map((part: string) => {
                const [number, url] = part.split("$");
                if (number && url && url.startsWith("http")) {
                  return { number: number.trim(), url: url.trim() };
                }
                return null;
              })
              .filter((ep: Episode | null): ep is Episode => ep !== null);

            // 查找匹配的剧集号
            const targetEpisode = newEpisodes.find((ep: Episode) => ep.number === currentEpNum);
            const targetEpNum = targetEpisode ? currentEpNum : newEpisodes[0].number;

            // 更新 URL 参数
            setSearchParams(
              {
                vodId: String(newVodId),
                epNum: encodeURIComponent(targetEpNum),
                source: newSourceKey,
              },
              { replace: true }
            );
          }
        }
      }
    } catch (error) {
      console.error("Error switching source:", error);
    }
  };

  // 在视频详情加载完成后搜索其他资源站
  useEffect(() => {
    if (movieDetails?.vod_name) {
      searchOtherSources();
    }
  }, [movieDetails?.vod_name]);

  // --- Final Calculations for Render ---
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>正在加载视频信息...</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-red-500">错误: {error}</p>
      </div>
    );
  }
  if (!movieDetails) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p>未能加载视频信息。</p>
      </div>
    );
  }

  // --- Render ---
  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Video Player Section */}
            <div className="lg:col-span-2 space-y-6">
              <div className="h-[250px] xl:h-[600px]">
                {currentSource ? (
                  <div ref={artRef} className="w-full h-full"></div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-800">请选择要播放的剧集</div>
                )}
              </div>

              {/* 影片信息 */}
              <Card className="border-border/50 bg-card/50 p-0">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-semibold mb-3">{movieDetails.vod_name}</h2>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>{movieDetails.vod_year}</span>
                        </div>
                        <Badge variant="outline" className="border-border/50">
                          {movieDetails.type_name}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Episode List Section */}
            <div className="space-y-6">
              <Card className="border-border/50 bg-card/50 p-0">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-4 border-b pb-2">
                    <div className="flex items-center gap-2">
                      <ListVideo className="w-5 h-5" />
                      <h3 className="font-semibold text-lg">剧集列表</h3>
                      <Badge variant="outline" className="border-border/50 bg-background/50">
                        {sortedEpisodes.length}集
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={toggleSortOrder}
                      className="text-muted-foreground hover:text-primary hover:bg-primary/10 px-3 py-1 rounded-md transition-colors">
                      <ArrowUpDown className="w-4 h-4 mr-1" />
                      {sortOrder === "asc" ? "正序" : "倒序"}
                    </Button>
                  </div>
                 
                    <ScrollArea className="h-[300px] md:h-[400px] xl:h-[480px]">
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-5 gap-2">
                        {sortedEpisodes.map((ep) => (
                          <Button
                            key={ep.number + ep.url}
                            variant={currentSource === ep.url ? "default" : "outline"}
                            size="sm"
                            className={`h-10 w-full transition-all duration-200 ${
                              currentSource === ep.url ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-border/50 hover:border-primary/50 hover:bg-primary/5"
                            }`}
                            onClick={() => handleEpisodeSelect(ep)}>
                            {ep.number}
                          </Button>
                        ))}
                      </div>
                    </ScrollArea>
                
                </CardContent>
              </Card>
              {/* 采集站切换 */}
              <Card className="border-border/50 bg-card/50 p-0">
                <CardContent className="p-4">
                  <h3 className="font-semibold mb-3">采集站切换</h3>
                  <div className="space-y-2">
                    {availableSources.map((source) => (
                      <Button
                        key={source.key}
                        variant={sourceKey === source.key ? "default" : "outline"}
                        className={`w-full justify-between ${sourceKey !== source.key ? "border-border/50" : ""}`}
                        onClick={() => handleSourceChange(source.key)}>
                        {source.name}
                        {sourceKey === source.key && <ChevronRight className="w-4 h-4" />}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>{" "}
        </div>{" "}
      </div>
    </>
  );
}

export default PlayerPage;
