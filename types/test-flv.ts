import mpegts from '../';

type LoaderStatusAlias = mpegts.LoaderStatus;
type LoaderErrorsAlias = mpegts.LoaderErrors;

interface MediaDataSourceExt extends mpegts.MediaDataSource {
    example: string;
}
